const PROBE_ORIGIN = "http://same-origin.invalid";
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Only same-origin relative paths are allowed as post-login destinations (no open redirects).
 *
 * Browsers remove tab, LF and CR from anywhere in a URL and treat "\" like "/" before resolving it, so
 * "/\t/evil.example" becomes "//evil.example" (another host). Any control character or backslash is therefore
 * refused outright, and the result must still resolve to this origin.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001F\u007F\\]/.test(value)) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback;

  const path = resolved.pathname.toLowerCase();
  if (path.startsWith("/api/") || AUTH_PAGES.some((page) => path.startsWith(page))) return fallback;
  return value;
}
