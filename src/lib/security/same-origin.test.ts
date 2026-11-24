import { describe, expect, it } from "vitest";
import { checkApiRequest, type RequestFacts } from "./same-origin";

const base: RequestFacts = { method: "POST", secFetchSite: null, origin: null, host: "app.school.example", forwardedHost: null };
const check = (overrides: Partial<RequestFacts>) => checkApiRequest({ ...base, ...overrides });

describe("checkApiRequest (same-origin guard for /api)", () => {
  it("never blocks safe methods, even cross-site", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(check({ method, secFetchSite: "cross-site", origin: "https://evil.example" }).allowed).toBe(true);
    }
  });

  it("allows same-origin browser writes (Fetch Metadata)", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(check({ method, secFetchSite: "same-origin", origin: "https://app.school.example" }).allowed).toBe(true);
    }
  });

  it("blocks cross-site, same-site and user-initiated ('none') writes", () => {
    expect(check({ secFetchSite: "cross-site" }).allowed).toBe(false);
    expect(check({ secFetchSite: "same-site" }).allowed).toBe(false); // another subdomain is still another origin
    expect(check({ secFetchSite: "none" }).allowed).toBe(false);
    expect(check({ secFetchSite: " Cross-Site " }).allowed).toBe(false);
  });

  it("Fetch Metadata wins over a matching Origin (cannot be bypassed with a forged-looking Origin)", () => {
    expect(check({ secFetchSite: "cross-site", origin: "https://app.school.example" }).allowed).toBe(false);
  });

  it("falls back to Origin when Fetch Metadata is absent (older browsers)", () => {
    expect(check({ origin: "https://app.school.example" }).allowed).toBe(true);
    expect(check({ origin: "http://app.school.example" }).allowed).toBe(true); // TLS terminated at the proxy: host comparison only
    expect(check({ origin: "https://evil.example" }).allowed).toBe(false);
    expect(check({ origin: "https://app.school.example.evil.example" }).allowed).toBe(false);
    expect(check({ origin: "null" }).allowed).toBe(false); // sandboxed iframe / file: / some redirects
    expect(check({ origin: "not a url" }).allowed).toBe(false);
  });

  it("accepts the forwarded host set by a trusted front proxy", () => {
    expect(check({ host: "internal:3000", forwardedHost: "app.school.example", origin: "https://app.school.example" }).allowed).toBe(true);
    expect(check({ host: "internal:3000", forwardedHost: "app.school.example", origin: "https://evil.example" }).allowed).toBe(false);
  });

  it("compares hosts including the port", () => {
    expect(check({ host: "localhost:3000", origin: "http://localhost:3000" }).allowed).toBe(true);
    expect(check({ host: "localhost:3000", origin: "http://localhost:3001" }).allowed).toBe(false);
  });

  it("allows non-browser clients that send neither header (no ambient cookies)", () => {
    expect(check({}).allowed).toBe(true);
  });
});
