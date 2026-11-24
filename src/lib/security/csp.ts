/**
 * Content-Security-Policy (release hardening, finding S4). Built per request with a fresh nonce in src/proxy.ts;
 * Next.js reads the nonce from the request's CSP header and applies it to its own scripts. All pages render
 * dynamically (the root layout reads the request headers), so every page gets a nonce.
 *
 * Scripts: strict. Only scripts carrying this request's nonce, plus scripts they load ('strict-dynamic').
 *   No 'unsafe-inline'. 'unsafe-eval' only in development (React dev tooling; Next.js guide).
 * Styles: 'self' 'unsafe-inline'. Deliberate and documented: React/Radix use inline style attributes, and
 *   Sonner and Radix Select/ScrollArea inject <style> elements at runtime without a nonce. A nonce in style-src
 *   would make browsers ignore 'unsafe-inline' and break them. Injecting styles requires injecting markup,
 *   which React's escaping prevents; scripts stay nonce-only.
 * Everything else: same origin only. API calls go to /api on this origin; fonts are self-hosted by next/font.
 * HSTS and upgrade-insecure-requests belong at the TLS-terminating proxy (they would break http test setups).
 */
export function buildCsp(nonce: string, { dev }: { dev: boolean }): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'", "blob:"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
