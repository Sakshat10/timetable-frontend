import { NextResponse, type NextRequest } from "next/server";
import { BLOCKED_BODY, checkApiRequest } from "@/lib/security/same-origin";
import { buildCsp, createNonce } from "@/lib/security/csp";

/**
 * Runs before routing:
 *  - /api/*: same-origin guard for state-changing browser requests (src/lib/security/same-origin.ts). Allowed
 *    requests continue to the rewrite that forwards them to the backend. Server-side calls are unaffected:
 *    they go straight to BACKEND_URL (src/lib/api/server.ts), not through this proxy.
 *  - pages: optimistic session check (no backend call; the authoritative check is GET /api/admin/me in
 *    src/app/(app)/layout.tsx) and a per-request Content-Security-Policy nonce.
 */
const SESSION_COOKIE = "session_token";
const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const verdict = checkApiRequest({
      method: request.method,
      secFetchSite: request.headers.get("sec-fetch-site"),
      origin: request.headers.get("origin"),
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    });
    if (!verdict.allowed) {
      return NextResponse.json(BLOCKED_BODY, { status: 403, headers: { "Cache-Control": "no-store", "X-Blocked-Reason": "cross-origin" } });
    }
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const nonce = createNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  // Lets the server auth gate send the user back to the requested page after signing in.
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  // Next.js reads the nonce from the request's CSP header and applies it to its scripts.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Runs on pages and on /api (for the same-origin guard); never on static assets or Next.js internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
