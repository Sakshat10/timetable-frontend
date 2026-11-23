import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route guard (FRONTEND-ARCHITECTURE.md §2.2): only checks that a session cookie is present.
 * It never calls the backend. The authoritative check is GET /api/admin/me in src/app/(app)/layout.tsx.
 */
const SESSION_COOKIE = "session_token";
const PUBLIC_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  // Lets the server auth gate send the user back to the requested page after signing in.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Never runs on the backend API, static assets or Next.js internals.
  matcher: ["/((?!api/|_next/|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
