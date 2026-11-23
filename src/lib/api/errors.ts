/**
 * One normalised error for every backend error dialect (docs/architecture/PHASE-0-AUDIT.md §1.0):
 *
 *  1. Zod validation   400 { success:false, message:"Validation failed", errors:{ "<path>": string[] } }
 *  2. Ajv validation   400 { message }                       (no `success`; runs before authentication)
 *  3. Coded refusal    4xx/503 { success:false, message, data:{ code, ...details } }   (versions, generation)
 *  4. Coded refusal    4xx { success:false, message, errors:{ code:[CODE], ...string[] } } (substitution)
 *  plus plain AppErrors { success:false, message, errors? } (e.g. errors.blockedBy), 429, and 5xx.
 *
 * 5xx bodies are never shown: they can contain internals (see BACKEND-OWNER-REQUEST.md §2).
 */

/** Keys inside `errors` that are details of a refusal rather than form-field messages. */
const DETAIL_KEYS = new Set(["code", "blockedBy", "periods", "coverRequestIds", "lessons", "absenceId"]);

export const GENERIC_SERVER_MESSAGE = "The server could not complete the request. Please try again in a moment.";
export const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "The server took too long to respond.";

export interface ApiErrorInit {
  status: number;
  code: string | null;
  message: string;
  fieldErrors: Record<string, string[]>;
  details: Record<string, unknown>;
  retryAfterMs: number | null;
  uncertain: boolean;
}

export class ApiError extends Error implements ApiErrorInit {
  readonly status: number;
  readonly code: string | null;
  readonly fieldErrors: Record<string, string[]>;
  readonly details: Record<string, unknown>;
  readonly retryAfterMs: number | null;
  /** A write whose outcome is unknown (network error, timeout, 500/502/504): never re-send it; re-read state. */
  readonly uncertain: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.details = init.details;
    this.retryAfterMs = init.retryAfterMs;
    this.uncertain = init.uncertain;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  /** 403 (another school's record) and 404 are both presented as "not found". */
  get isNotFound() {
    return this.status === 404 || this.status === 403;
  }
  get isConflict() {
    return this.status === 409;
  }
  get isNetwork() {
    return this.status === 0;
  }
  /** The first message for a field path, if any. */
  fieldError(path: string): string | undefined {
    return this.fieldErrors[path]?.[0];
  }
  /** Messages not attached to any known field (root-level refinements, Ajv messages, unmatched paths). */
  formErrors(knownPaths: readonly string[] = []): string[] {
    return Object.entries(this.fieldErrors)
      .filter(([path]) => !knownPaths.includes(path))
      .flatMap(([, messages]) => messages);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asStringArrayRecord = (value: unknown): Record<string, string[]> => {
  if (!isObject(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) out[key] = messages.map(String);
    else if (typeof messages === "string") out[key] = [messages];
  }
  return out;
};

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 120) * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 120_000));
  return null;
}

const isWriteMethod = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/** Builds an ApiError from an HTTP response status and its (already parsed, possibly null) JSON body. */
export function normaliseHttpError(args: {
  status: number;
  body: unknown;
  method: string;
  retryAfter: string | null;
}): ApiError {
  const { status, body, method } = args;
  const retryAfterMs = parseRetryAfter(args.retryAfter);
  const write = isWriteMethod(method);

  if (status >= 500) {
    // 503 with the backend envelope is a controlled refusal (BUSY, queue full): nothing was applied and the message is safe.
    if (status === 503 && isObject(body) && body.success === false && typeof body.message === "string") {
      const data = isObject(body.data) ? body.data : {};
      const { code, ...details } = data;
      return new ApiError({
        status,
        code: typeof code === "string" ? code : null,
        message: body.message,
        fieldErrors: {},
        details,
        retryAfterMs,
        uncertain: false,
      });
    }
    return new ApiError({
      status,
      code: null,
      message: GENERIC_SERVER_MESSAGE,
      fieldErrors: {},
      details: {},
      retryAfterMs,
      uncertain: write && status !== 501,
    });
  }

  if (!isObject(body)) {
    return new ApiError({
      status,
      code: null,
      message: status === 429 ? "Too many attempts. Please wait a few minutes and try again." : GENERIC_SERVER_MESSAGE,
      fieldErrors: {},
      details: {},
      retryAfterMs,
      uncertain: false,
    });
  }

  const message = typeof body.message === "string" && body.message.trim() !== "" ? body.message : "The request could not be completed.";

  // Dialect 2: Fastify/Ajv schema validation, `{ message }` only.
  if (!("success" in body) && status === 400) {
    return new ApiError({
      status,
      code: null,
      message: "Some of the information sent was not in the expected format.",
      fieldErrors: { _form: [message] },
      details: {},
      retryAfterMs,
      uncertain: false,
    });
  }

  const errors = asStringArrayRecord(body.errors);
  const data = isObject(body.data) ? body.data : null;

  // Dialect 3: coded refusal in `data`.
  let code: string | null = data && typeof data.code === "string" ? data.code : null;
  const details: Record<string, unknown> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) if (key !== "code") details[key] = value;
  }

  // Dialect 4 (+ blockedBy etc.): details inside `errors`.
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(errors)) {
    if (key === "code") {
      code ??= messages[0] ?? null;
    } else if (DETAIL_KEYS.has(key)) {
      details[key] = messages;
    } else {
      fieldErrors[key] = messages;
    }
  }

  return new ApiError({
    status,
    code,
    message: status === 429 ? "Too many attempts. Please wait a few minutes and try again." : message,
    fieldErrors,
    details,
    retryAfterMs,
    uncertain: false,
  });
}

export function networkError(method: string, timedOut: boolean): ApiError {
  return new ApiError({
    status: 0,
    code: timedOut ? "TIMEOUT" : "NETWORK",
    message: timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
    fieldErrors: {},
    details: {},
    retryAfterMs: null,
    uncertain: isWriteMethod(method),
  });
}

/** A user-facing sentence for any thrown value (never exposes raw internal errors). */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return "Something went wrong. Please try again.";
}
