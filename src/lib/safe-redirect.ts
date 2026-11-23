/** Only same-origin relative paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.startsWith("/login") || value.startsWith("/signup") || value.startsWith("/api/")) return fallback;
  return value;
}
