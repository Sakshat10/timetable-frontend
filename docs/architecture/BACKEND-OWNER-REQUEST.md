# Request to the backend owner

- **From:** frontend rebuild (Timetable Maker 2.0)
- **Backend inspected:** `timetable-backend` at `64b392390cd45af97246478a5235d754fa3b59f6`
- **Status:** for discussion. The frontend team will not change the backend.

The frontend will reach the API through its own origin: the browser calls `/api/*` on the Next.js host, and Next.js forwards the request to Fastify. Nothing in this request changes business rules, the database schema, migrations or the solver.

## Critical

### 1. Configure `TRUST_PROXY` for the real proxy chain (deployment configuration, no code change)

**Problem.** The login, admin-registration and school-creation rate limiters key on `request.ip` (`src/middleware/rate-limit.middleware.ts:48-86`). With the default `TRUST_PROXY=false`, `request.ip` is the socket address (`src/config/security.ts:43-94`).

Behind the frontend's forwarding layer, that socket address is the Next.js server, so every user shares one allowance. Five failed logins by anyone, within 15 minutes, would block login for the whole deployment.

**Ask.** Set `TRUST_PROXY` to the exact trusted chain in front of Fastify, either as a hop count or as proxy addresses/CIDRs. Never use `true`, `*` or a `/0` range; the backend already refuses those.

**Measured (Phase 1, T5; details and tables in `PHASE-1-AUTH-PROXY-RESULTS.md`):**
- Next.js `rewrites()` forwards a client-supplied `X-Forwarded-For` **unchanged**, and adds none when the client sent none.
- Next.js exposed directly: every `TRUST_PROXY` value fails.
  - `false` puts all users in one login bucket.
  - `1` and `loopback` let any client choose its address: the spoof was accepted and the 429 was escaped.
- Behind a trusted front proxy that writes `X-Forwarded-For` (overwrite or append): **`TRUST_PROXY=1`** gives every client its own bucket, and spoofed values are ignored.

**Recommendation:**
1. Deploy as client → trusted reverse proxy or load balancer (writes `X-Forwarded-For`) → Next.js → Fastify.
2. Set **`TRUST_PROXY=1`** for that chain.
3. Make Fastify reachable **only** from Next.js (private network or firewall). With `TRUST_PROXY=1`, a direct caller could set its own address (observed in T5.1). Alternatively, list the Next.js host addresses or CIDRs instead of a hop count.
4. If a CDN sits in front of the load balancer, re-measure on staging (T5.7) before choosing the value. The frontend team runs `npm run e2e:ip`, adapted to the staging URLs.

Related: the limiter is in memory and per process, so multiple backend instances multiply the limits. This is already documented in `.env.example`, and no change is requested.

### 2. Stop raw database errors leaking from session validation (code change)

**Problem.** `authMiddleware` (`src/middleware/auth.middleware.ts:26`) awaits `adminService.validateSession()` without `try/catch`. When that throws, for example because the database is unreachable, the error goes to Fastify's default error handler (the app registers no `setErrorHandler`). The client then receives the raw Prisma message, which includes a source file path and a code excerpt.

**Reproduced** on 2026-11-23, in memory, with `NODE_ENV=production`, a strong `COOKIE_SECRET` and an unreachable `DATABASE_URL`:

| Request | Result |
|---|---|
| `POST /api/admin/login` | `500 {"success":false,"message":"An unexpected error occurred"}`: safe, because the controller's `handleError` catches it |
| `GET /api/admin/me` with a `session_token` cookie | `500 {"statusCode":500,"code":"P1001","error":"Internal Server Error","message":"\nInvalid \`this.db.adminSession.findUnique()\` invocation in\n/…/src/modules/admin/admin.service.ts:132:48\n\n 129 async validateSession(…"}` |
| `GET /api/teachers` with a cookie | same leak |
| `GET /api/teachers` without a cookie | 401, so no leak |

**Scope.** This is broader than the login path. It affects **every authenticated route** whenever a session cookie is present and session lookup throws. The login endpoint itself is not affected.

**Ask.** Make an auth-middleware failure produce the standard generic 500 envelope (`{ success:false, message:"An unexpected error occurred" }`) and log the details server-side only.
- Option A: wrap the middleware in `try/catch` and call `handleError`.
- Option B: add an application-level `setErrorHandler` that never echoes the message of a 5xx error. This also covers any future unhandled path.

**Frontend mitigation, regardless of the fix:** the frontend never displays the body of a 5xx response.

### 2a. Findings from the 2026-11-27 security audit (code changes)

The details, evidence and remediations are in `SECURITY_AUDIT_REPORT.md` at the frontend repository root. In priority order:

- **B-1 (MEDIUM).** The generation queue cap is global (`timetable-generation.run-repository.ts:109-110`). One school can keep the 10 slots full for every school. Add a per-school active-run cap.
- **B-3 (MEDIUM).** `npm audit` reports `zod` (high, runtime), `fast-uri` and `fastify`, all fixable without breaking changes (`npm audit fix`).
- **B-2 (MEDIUM).** Login timing reveals existing admin emails: unknown emails return in about 2 ms, known emails in 50–230 ms (`admin.service.ts:89-92`). Verify against a dummy hash when no admin is found.
- **B-5 (LOW).** Solver stderr is returned in `failure.message` (`timetable-generation.solver-client.ts:258-266`).
- **B-6 (LOW).** The cookie is `Secure`/`Strict` only when `NODE_ENV === "production"`, while startup checks treat an unset `NODE_ENV` as production (`admin.controller.ts:75-80`).
- **B-7 (LOW).** `/docs` is always registered, and `HOST` defaults to `0.0.0.0`.
- **B-8 to B-12 (LOW).**
  - DRAFT-only checks outside the year lock.
  - Academic-year lifecycle not enforced: several ACTIVE years make cover requests silently disappear.
  - Stream-name uniqueness race.
  - No limits on expensive authenticated routes.
  - Per-IP-only login limiting.
  - The uncommitted change raising the school-creation limit to 3 per day.

## Deferred (no action needed now)

### 3. Login by school code

The frontend will use the school UUID for login at first. It shows the ID after sign-up and remembers it per device. We may later ask for a public lookup or a login that accepts the school `code`, which is unique. The rate-limiting and enumeration implications would need discussing at that point. **Not requested now.**

### 4. Additional response headers: none needed

We examined every response header the frontend could need:

| Header | Sent by | Frontend workflow | Needed? |
|---|---|---|---|
| `Location` | `POST /timetable-generations` (202); `POST /timetable-versions/:id/clone` (201) | Find the new run or version | **No.** The body already carries the id (`data.generationRunId`; the new version's `data.id`). |
| `Retry-After` | 503 `BUSY` (versions, generation) and 503 queue-full (generation) | Back off before retrying | **No.** Responses are same-origin through the proxy, so CORS `exposedHeaders` does not apply and the header is readable. Phase 1 test T6.3 confirms this. |
| `Set-Cookie` | login, logout | Session | Passed through by the proxy (T2.x), and no CORS exposure is involved. |
| Request header `Idempotency-Key` | `POST /teachers/bulk` | Bulk teacher creation | Same-origin, so no CORS preflight applies. |

**Conclusion:** no CORS or header change is requested.

The only case for `exposedHeaders: ['Location','Retry-After']` is a future cross-origin client. If Phase 1 tests show the proxy strips `Retry-After`, we will fix that on the frontend side, not here.

## Low priority

- **Logout cookie attributes.** In production, login sets `HttpOnly; Secure; SameSite=Strict`, but logout's clearing cookie is `Max-Age=0; Path=/; SameSite=Lax`, without `Secure` (observed 2026-11-24). Browsers still remove the cookie over HTTPS, and the server-side session is deleted, so nothing breaks. Matching the attributes (`clearCookie(name, { path: '/', secure, sameSite })`) would be tidier.

## Documentation drift (low priority, for whenever docs are next touched)

These were found during the audit (`PHASE-0-AUDIT.md` §9):
- The locks route says generation ignores locks; it does not, via `options.sourceVersionId`.
- The substitution route text says the second candidate tier is `OTHER_ELIGIBLE` and that candidates must be qualified; the code uses `OTHER_AVAILABLE` and requires no subject link.
- The substitution README lists `ONLY_LAST_RESORT_CANDIDATES`, which does not exist in code.
- The docs say absence cancel and PATCH are blocked by any ASSIGNED cover; in code, only MANUAL ones block.
- The event route description omits `COVER_OBSOLETED`.
- The school README omits `setupToken` and `setupTokenExpiresAt`.
- "One ACTIVE academic year per school" is described in the academic-year README but not enforced (`academic-year.service.ts:198-205`). The frontend will prevent a second activation in the UI, but the backend does not.
