import "server-only";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/server-env";
import { ApiError, networkError, normaliseHttpError } from "./errors";
import { buildQuery, type QueryValue } from "./client";

export const SESSION_COOKIE = "session_token";

/**
 * Server-side GET to the backend for Server Components (auth gate, year layout).
 * Forwards ONLY the session cookie and never caches (responses are per session).
 */
export async function serverGet<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error(`API paths must start with /api/ (got ${path})`);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;

  const timeout = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch(`${serverEnv().BACKEND_URL}${path}${buildQuery(query)}`, { headers, cache: "no-store", signal: timeout });
  } catch {
    throw networkError("GET", timeout.aborted);
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw normaliseHttpError({ status: response.status, body: json, method: "GET", retryAfter: response.headers.get("retry-after") });
  }
  return (json as { data: T }).data;
}

/** True when a session cookie is present (optimistic only; the backend decides). */
export async function hasSessionCookie(): Promise<boolean> {
  return Boolean((await cookies()).get(SESSION_COOKIE)?.value);
}

export { ApiError };
