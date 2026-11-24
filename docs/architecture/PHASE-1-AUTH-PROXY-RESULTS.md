# Phase 1: authentication and proxy test results

- **Plan:** `AUTH-PROXY-TEST-PLAN.md`.
- **Backend:** `timetable-backend` @ `64b392390cd45af97246478a5235d754fa3b59f6`, unchanged.
- **Database:** only the disposable local `timetable_dashboard_e2e_test`.
- **Run date:** 2026-11-23/24.

This file records what actually ran. Anything not run is listed as such.

## Decision

**The forwarding layer is option A, Next.js `rewrites()`.** It forwards `/api/*` to `BACKEND_URL`.

**What this requires of the deployment:**
1. A trusted reverse proxy or load balancer in front of Next.js that **writes** `X-Forwarded-For` (overwrite with the socket address, or append to it).
2. Next.js must not be reachable directly from the internet.
3. Fastify must be reachable **only** from Next.js.
4. The backend's `TRUST_PROXY` is set to the hop count of trusted proxies between the client and Fastify. Measured locally: **`1`** for the topology client → front proxy → Next.js → Fastify. Re-measure on staging (T5.7).

Why (measured, see T5):
- Next.js forwards a client's own `X-Forwarded-For` **unchanged**, and adds none when the client sent none (rewrite path).
- A route handler gets the real socket address only when the client did not send `X-Forwarded-For` (Next sets it with `??=`, `node_modules/next/dist/server/base-server.js:604`).
- So no forwarding code inside Next.js can stop a direct client from spoofing its address. The guarantee has to come from a front proxy, and option B (a route-handler proxy) would add code without adding protection.

## T5: client-IP propagation and the login limiter

**How it was measured:**
- Script: `e2e/real/ip-propagation.mjs`, with the front-proxy emulator `e2e/real/front-proxy.mjs`.
- A second backend process ran on :4011 with environment variables only: `NODE_ENV=production`, `LOG_LEVEL=info`, `TRUST_PROXY=<case>`, and a generated `COOKIE_SECRET`.
- `Fastify request.ip` was read from its request log (`remoteAddress`).
- Clients were 127.0.0.1, ::1 and the LAN address 192.168.1.10.
- Login-limiter behaviour was the secondary check (5 per 15 minutes per client).
- Next.js ran in `dev` mode. The rewrite proxy code path (`router-utils/proxy-request.js`) is the same in `next start`.

### No front proxy (Next.js exposed directly)

| TRUST_PROXY | Real clients 127.0.0.1 / ::1 / 192.168.1.10 → request.ip | Client-supplied `XFF: 203.0.113.7` | Second client after the first is limited | Spoofed request from a limited client |
|---|---|---|---|---|
| `false` | 127.0.0.1 / 127.0.0.1 / 127.0.0.1 | 127.0.0.1 | **429 (shared bucket)** | 429 |
| `1` | 127.0.0.1 / 127.0.0.1 / 127.0.0.1 | **203.0.113.7 (spoofed)** | 429 (shared bucket) | **401 (spoof accepted)** |
| `loopback` | 127.0.0.1 / 127.0.0.1 / 127.0.0.1 | **203.0.113.7 (spoofed)** | 429 (shared bucket) | **401 (spoof accepted)** |

**Result: fails in every configuration.** With `false`, every user shares one login allowance. With `1` or `loopback`, any client can choose its address.

### Behind a trusted front proxy (emulated nginx)

| Front proxy | TRUST_PROXY | Real clients → request.ip | Client-supplied `XFF: 203.0.113.7` | Second client after the first is limited | Spoofed request from a limited client |
|---|---|---|---|---|---|
| append (`$proxy_add_x_forwarded_for`) | `false` | 127.0.0.1 for all | 127.0.0.1 | 429 (shared) | 429 |
| append | **`1`** | ::ffff:127.0.0.1 / ::1 / ::ffff:192.168.1.10 | **192.168.1.10 (real)** | **401 (own bucket)** | **429 (spoof rejected)** |
| overwrite (`$remote_addr`) | `false` | 127.0.0.1 for all | 127.0.0.1 | 429 (shared) | 429 |
| overwrite | **`1`** | ::ffff:127.0.0.1 / ::1 / ::ffff:192.168.1.10 | **192.168.1.10 (real)** | **401 (own bucket)** | **429 (spoof rejected)** |

**Result: passes with `TRUST_PROXY=1`.** The IPv4-mapped forms are normalised by the backend's `clientKey()` (`rate-limit.middleware.ts:30-40`).

**Direct-access warning (T5.1):** with `TRUST_PROXY=1`, a request sent **directly** to Fastify with `X-Forwarded-For: 198.51.100.1` was logged as 198.51.100.1. Fastify must therefore not be reachable except through Next.js. Alternatively, `TRUST_PROXY` can list the Next.js host addresses instead of a hop count.

**Not run:** T5.7, the real staging chain. Go-live is blocked until it passes. If a CDN sits in front of the load balancer, the hop count is expected to rise; it must be measured there.

## T1–T4, T7 (Playwright, `e2e/auth.spec.ts`, real backend :4010 through the Next.js proxy on :3100)

Final run: **13 passed, 0 failed**. The test IDs:

| Test | Result |
|---|---|
| T1.3 malformed School ID caught before any request | passed |
| T1.2 invalid credentials: generic message, no cookie, no reset or school-code wording | passed |
| T1.1/T2.1/T2.3 HttpOnly first-party cookie (`localhost`, `Path=/`, `SameSite=Lax` in E1, about 7 days), not readable by JS, lands on the dashboard, external `next` ignored | passed |
| T2.4 session persists in a new browser context | passed |
| T3.1 client reads are same-origin with no CORS preflight | passed |
| T4.1 expiry is absolute (`expiresAt` unchanged after requests; disposable DB read) | passed |
| T7.6 a 500 containing Prisma internals and a source path shows only the generic message | passed |
| T4.2/T4.6 expired session (disposable DB write): one redirect to `/login?reason=expired`, one notice, `next` kept, server row deleted | passed |
| T1.4 logout clears the cookie; replaying the old token returns 401 | passed |
| T4.4 no cookie → `/login?next=<path>` | passed |
| T4.5 invalid cookie → login, no protected content rendered | passed |
| T7.1–T7.3 401 messages through the proxy; Ajv 400 `{message}` before auth | passed |
| T7.4 another school's year → 403 from the API, "Page not found" in the UI | passed (created "QA Isolation School" in the disposable DB) |

**E2 (production-like cookie flags):** the `Set-Cookie` from the `NODE_ENV=production` backend on :4011 was observed in the T5 runs. A browser-level check of `Secure; SameSite=Strict` through Next.js (T2.2) is **not yet automated**. It needs an HTTPS or Chromium-on-localhost run, and is listed in the README as a release check.

**T6:**
- **Covered:** CORS is irrelevant same-origin (T3.1, T6.1).
- **Not automated yet:** the direct-call and cross-site form checks (T6.2, T6.4, T6.5).
- **Behaviour covered in code:**
  - the session cookie is `SameSite` (`Lax` in development, `Strict` in production);
  - writes are JSON;
  - the frontend has no state-changing GET routes.
