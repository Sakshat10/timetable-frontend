/**
 * Same-origin guard for browser requests to the backend through /api/* (release hardening, finding S3).
 *
 * The session cookie is SameSite, so a cross-site page cannot make an AUTHENTICATED request. It can,
 * however, make the browser send an unauthenticated state-changing request whose response is applied by
 * the browser. A top-level cross-site form POST to /api/admin/logout returns `Set-Cookie: session_token=;
 * Max-Age=0` and signs the user out (forced logout, verified in FINAL-PRODUCTION-READINESS-REPORT §5).
 *
 * Rule, for state-changing methods only (POST, PUT, PATCH, DELETE):
 *  1. Fetch Metadata present  → allow only `Sec-Fetch-Site: same-origin`.
 *  2. Otherwise Origin present → allow only when its host equals the request host (Host or X-Forwarded-Host).
 *  3. Neither header           → allow. Browsers send at least one of them on cross-origin state-changing
 *     requests; requests without both come from non-browser clients (curl, scripts, server-side code), which
 *     carry no ambient browser cookies.
 * Safe methods (GET, HEAD, OPTIONS) are not blocked: they change no state and CORS stops cross-site reads.
 */
export type GuardVerdict = { allowed: true } | { allowed: false; reason: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RequestFacts {
  method: string;
  secFetchSite: string | null;
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkApiRequest(facts: RequestFacts): GuardVerdict {
  if (SAFE_METHODS.has(facts.method.toUpperCase())) return { allowed: true };

  const site = facts.secFetchSite?.trim().toLowerCase();
  if (site) {
    return site === "same-origin" ? { allowed: true } : { allowed: false, reason: `sec-fetch-site=${site}` };
  }

  const origin = facts.origin?.trim();
  if (origin) {
    if (origin === "null") return { allowed: false, reason: "origin=null" };
    const originHost = hostOf(origin);
    const hosts = [facts.host, ...(facts.forwardedHost?.split(",") ?? [])]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    return originHost && hosts.includes(originHost) ? { allowed: true } : { allowed: false, reason: "origin mismatch" };
  }

  return { allowed: true };
}

/** The JSON body returned for a blocked request (same envelope as the backend, so the client normaliser handles it). */
export const BLOCKED_BODY = {
  success: false,
  message: "This request was blocked because it did not come from this application.",
} as const;
