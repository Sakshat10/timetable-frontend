import { ApiError, networkError, normaliseHttpError } from "./errors";

/**
 * Browser API client. Every request goes to `/api/*` on this origin (forwarded to Fastify by
 * next.config.ts), so the HttpOnly session cookie is sent automatically and is never readable by JS.
 *
 * - Returns the envelope's `data`; `apiEnvelope` also returns `message` and response headers.
 * - JSON bodies only. A request without a body sends no Content-Type (the backend rejects an
 *   empty JSON body, e.g. DELETE of a draft version).
 * - Writes are never retried here. Callers decide (see ApiError.uncertain / retryAfterMs).
 * - Any 401 (except on the login request itself) notifies the session listener once.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Default 30 s. */
  timeoutMs?: number;
  /** Do not emit the global "session ended" signal for a 401 (used by the login and session probes). */
  skipUnauthorizedSignal?: boolean;
}

export interface Envelope<T> {
  data: T;
  message: string;
  headers: Headers;
  status: number;
  /** The whole JSON body (for envelope-level fields such as `replayed` on bulk teacher creation). */
  body: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
let unauthorizedSignalled = false;

/** Subscribe to "the session is no longer valid". Returns an unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

/** Re-arm the one-shot 401 signal (after a successful login). */
export function resetUnauthorizedSignal() {
  unauthorizedSignalled = false;
}

function signalUnauthorized() {
  if (unauthorizedSignalled) return;
  unauthorizedSignalled = true;
  for (const listener of unauthorizedListeners) listener();
}

export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function apiEnvelope<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  if (!path.startsWith("/api/")) throw new Error(`API paths must start with /api/ (got ${path})`);

  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(`${path}${buildQuery(options.query)}`, {
      method,
      headers,
      body,
      signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    // A caller-initiated abort is not an application error: rethrow it untouched for TanStack Query.
    if (options.signal?.aborted) throw error;
    throw networkError(method, timeout.aborted);
  }

  const json = await readJson(response);

  if (!response.ok) {
    const error = normaliseHttpError({
      status: response.status,
      body: json,
      method,
      retryAfter: response.headers.get("retry-after"),
    });
    if (error.status === 401 && !options.skipUnauthorizedSignal) signalUnauthorized();
    throw error;
  }

  const envelope = (json ?? {}) as { data?: T; message?: string } & Record<string, unknown>;
  return {
    data: envelope.data as T,
    message: typeof envelope.message === "string" ? envelope.message : "",
    headers: response.headers,
    status: response.status,
    body: envelope,
  };
}

export async function api<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
  const envelope = await apiEnvelope<T>(method, path, options);
  return envelope.data;
}

export { ApiError };
