# Authentication and proxy test plan (Phase 1)

- **Status:** plan for review (Phase 0 gate, Decision 5.5). Nothing here has been run.
- **Goal:** prove experimentally, without assuming, that session-cookie auth works through the same-origin forwarding layer. In particular, the real client IP must reach Fastify and must not be spoofable.
- **Outputs:**
  - `docs/architecture/PHASE-1-AUTH-PROXY-RESULTS.md`: per-test pass or fail, with evidence (commands, status codes, log lines, screenshots);
  - the forwarding-layer decision (option A rewrites or option B route handler; `FRONTEND-ARCHITECTURE.md` §2.1);
  - the measured `TRUST_PROXY` recommendation for the backend owner.

## 0. Safety rules (apply to every test)

- **Database.** Only the disposable local database `timetable_dashboard_e2e_test`, managed by `timetable-backend/e2e/dashboard/e2e.sh`.
  - The script verifies the database identity before any operation.
  - Never use port 4000, the backend `.env`, Neon, or any other database.
- **No backend code changes.** Backend behaviour is varied **only through environment variables** on separate local processes: `NODE_ENV`, `TRUST_PROXY`, `COOKIE_SECRET`, `FRONTEND_URL`, `LOG_LEVEL`, `GENERATION_RUNNER_ENABLED`, `SOLVER_QUEUE_MAX`.
- **Secrets.** `COOKIE_SECRET` for the production-like instance is generated per run (`openssl rand -base64 48`). It is kept in the shell only, and never written to a file or committed.
- **Direct database access.** Tests T4.1, T4.2 and T7.4 read or write `admin_sessions` in the **disposable** database with `psql` (connection details from `e2e.sh`). These are the only direct database operations. **They need explicit approval before Phase 1 runs them.**
- **Cleanup.** After the suite: stop the extra backend instance. If anything was written (sessions, a second school, queued runs), run `e2e.sh reset --yes --seed`, which drops and reseeds **only** the disposable database.

## 1. Environments

| Id | Backend | Frontend | Used for |
|---|---|---|---|
| **E1 (dev-like)** | `e2e.sh start-bg` → `http://127.0.0.1:4010`; `NODE_ENV=test`; cookie `SameSite=Lax`, no `Secure`; `TRUST_PROXY` unset | `next dev` on `http://localhost:3000`, `BACKEND_URL=http://127.0.0.1:4010` | Functional auth flows, 401/403, contracts |
| **E2 (prod-like)** | A second backend process on `127.0.0.1:4011`, started with `env -i` against the same disposable database: `NODE_ENV=production`, generated `COOKIE_SECRET`, `FRONTEND_URL=http://localhost:3000`, `LOG_LEVEL=info`, `GENERATION_RUNNER_ENABLED=false`, `TRUST_PROXY=<case>` | `next build && next start -H ::` (dual-stack) on port 3000, `BACKEND_URL=http://127.0.0.1:4011` | Production cookie flags (`Secure`, `SameSite=Strict`), IP propagation, throttling, header passthrough |
| **E3 (staging)** | The real deployment backend with the real proxy chain | The real deployment frontend over HTTPS | Repeats T2 and T5 on the real chain before go-live. The final `TRUST_PROXY` value comes from here. |

Notes:
- **`Secure` cookies on `http://localhost`.** Chromium accepts them, so E2 browser tests use Playwright's Chromium. WebKit does not, so a WebKit failure on E2 is an environment artefact, not a product defect. E3 covers HTTPS for real.
- **Observing `request.ip`.** With `LOG_LEVEL=info`, Fastify's request log records `remoteAddress`, which is `request.ip` after `TRUST_PROXY` is applied. This is the **primary observation**. The **secondary** one is behavioural: which requests share a login rate-limit bucket.
- **Distinct client addresses without root.** Use `127.0.0.1` (IPv4 loopback), `::1` (IPv6 loopback) and the machine's LAN address (from `ipconfig getifaddr en0`). The limiter keys these separately (`clientKey`, `rate-limit.middleware.ts:30-40`). **Spoofing tests must use the LAN address**, because with `TRUST_PROXY=loopback` a loopback client is itself trusted.
- **Restarts.** The rate limiter is in memory, so restart the E2 backend between throttling cases. Never restart a process you did not start.

## 2. Test cases

Each case records: environment, steps (exact commands or the Playwright spec), expected result, actual result, evidence and verdict.

### T1. Login and logout

| Id | Env | Steps | Expected |
|---|---|---|---|
| T1.1 | E1, E2 | In a browser: open `/login`, submit the seeded School ID, email and password | 200. The browser holds `session_token` for the **frontend host** (`localhost`), not for `127.0.0.1:4010/4011`. Then redirect to `/dashboard`. |
| T1.2 | E1 | Wrong password | 401. The form shows "Invalid email or password". No cookie is set. |
| T1.3 | E1 | Malformed School ID (not a UUID) | 400. Field error under School ID (the Zod/Ajv dialect is normalised). |
| T1.4 | E1, E2 | Log out from the UI | `POST /api/admin/logout` returns 200, the cookie is cleared (`Max-Age=0`) and the page moves to `/login`. A replay of the old token with `curl -H 'Cookie: session_token=<old>' …/api/admin/me` returns **401**, which proves the server deleted the session. |
| T1.5 | E1 | Log in while already logged in, as another admin | The new cookie replaces the old one and the old session still exists server-side. Documented, not a defect. |
| T1.6 | E1 | Sign-up flow: create school → register admin → log in | 201, 201, 200. The setup token is never in `localStorage`, `sessionStorage`, cookies or the URL (checked in Playwright). |

### T2. Cookie creation and persistence

| Id | Env | Steps | Expected |
|---|---|---|---|
| T2.1 | E1 | `context.cookies()` after login | `session_token`: `httpOnly:true`, `sameSite:'Lax'`, `secure:false`, `path:'/'`, `expires` about 7 days ahead, domain `localhost` |
| T2.2 | E2 | the same | `httpOnly:true`, `sameSite:'Strict'`, **`secure:true`**, `path:'/'`, about 7 days, domain `localhost` |
| T2.3 | E1, E2 | `document.cookie` in the page | Does **not** contain `session_token` |
| T2.4 | E1, E2 | Save `storageState`, close the browser, open a new context with that state, go to `/dashboard` | Still authenticated (the cookie is persistent) |
| T2.5 | E1, E2 | Inspect the raw `Set-Cookie` on the proxied login response (`curl -i` through the frontend) | Exactly one `Set-Cookie`, with attributes unchanged by the forwarding layer (no `Domain` added, no attributes dropped) |
| T2.6 | E2 | Server Component reads | The `(app)/layout.tsx` gate gets 200 from `/api/admin/me` via `serverFetch`. The backend log shows the request **with only `session_token`** in the forwarded cookie (other browser cookies are not forwarded). |

### T3. Authenticated API requests

| Id | Env | Steps | Expected |
|---|---|---|---|
| T3.1 | E1 | From the logged-in app, load `/subjects` (client fetch through `/api/subjects`) | 200. The network panel shows a **same-origin** request with no preflight `OPTIONS`. |
| T3.2 | E1 | A write: create a subject | 201. Content-Type `application/json` and the cookie are sent. |
| T3.3 | E1 | A bodiless DELETE (a draft version, or a test subject) | No `Content-Type` header is sent, and the response is 200. |
| T3.4 | E1 | `POST /api/teachers/bulk` with an `Idempotency-Key` header, then the identical request again | 201, then 200 with `replayed:true`. The request header passes through the forwarding layer. |
| T3.5 | E1 | Contract spot checks through the proxy: `/admin/me`, `/academic-years`, `/timetable-versions?academicYearId=…&includeStaleness=true`, `/substitutions?from=…&to=…` | Shapes match `lib/api` types and schemas |

### T4. Session expiration

| Id | Env | Steps | Expected |
|---|---|---|---|
| T4.1 | E1 | **(DB read, approval needed.)** Read `admin_sessions.expiresAt` for the test session. Make about 10 authenticated requests. Read it again. | `expiresAt` is **unchanged** (absolute 7-day expiry, no sliding renewal). `lastUsedAt` advanced. |
| T4.2 | E1 | **(DB write to the disposable DB, approval needed.)** `UPDATE admin_sessions SET "expiresAt" = now() - interval '1 minute' WHERE id = <test session>`. Then make a client navigation and a background fetch. | Both get 401 `"Invalid or expired session"`. The UI redirects **once** to `/login?next=<path>` with a single "Your session ended" notice, and the query cache is cleared. The backend deleted the session row. |
| T4.3 | E1 | Log out in tab A. Tab B (same browser) makes a request. | 401, then tab B redirects to login |
| T4.4 | E1 | Clear the cookie manually, then navigate | `proxy.ts` redirects to `/login?next=…` **without** calling the backend (no request in the backend log) |
| T4.5 | E1 | Cookie present but the token is invalid (edited), then navigate | `proxy.ts` lets it through (optimistic check). The server gate gets a 401 and redirects. No protected content is rendered first (checked with a page snapshot before the redirect). |
| T4.6 | E1 (mocked) | 5 parallel queries all return 401 | Exactly one redirect and one notice |

### T5. Login throttling and client IP propagation (core experiment)

These run on E2 for **each forwarding option** (A: rewrites, B: route handler) × **each `TRUST_PROXY`** value in {`false`, `1`, `loopback`}. The backend is restarted between cases. All logins use a non-existent account, so every attempt counts and no session is created.

| Id | Steps | Expected if propagation works | Interpretation |
|---|---|---|---|
| T5.1 Baseline | Client `127.0.0.1` → **directly** to the backend on `:4011` | `remoteAddress = 127.0.0.1` | Calibrates the log field |
| T5.2 Observe IP | Client IPv4 (`curl -4 http://localhost:3000/api/admin/login …`), client IPv6 (`curl -6 …`) and the LAN client (`curl http://<lan-ip>:3000/…`), one request each through the frontend | The log shows three **different** `remoteAddress` values, equal to each client | All three show the Next.js server's address → **not propagated** |
| T5.3 Bucket isolation | From client 1: 5 failed logins, then a 6th | The 6th is **429** | Limiter active |
| T5.4 | Immediately after: client 2 (a different address) makes one failed login | **401** (its own bucket) | **429** → all users share one bucket, so the option or setting **fails** |
| T5.5 Spoof | The LAN client sends `X-Forwarded-For: 203.0.113.7` (and in a second run `X-Forwarded-For: <client 2's address>`), with an exhausted bucket from T5.3 | Still **429**. The log shows the **real** LAN address. | 401, or the log shows the spoofed value → **spoofable**, so the option or setting **fails** (critical) |
| T5.6 Headers seen | In option B, log the inbound and outbound `X-Forwarded-*` headers in the route handler (debug flag, local only). In option A, use `nc -l` as a stand-in backend to capture what the rewrite sends. | Documented header set: `X-Forwarded-For`, `-Proto`, `-Host` | Shows exactly what the rewrite adds, replaces or passes through |
| T5.7 Staging chain | E3: repeat T5.2–T5.5 through the real load balancer/CDN → Next.js → Fastify | Real client IPs are distinct and the spoof is rejected | Gives the final `TRUST_PROXY` (expected: a hop count equal to the number of trusted proxies in front of Fastify, or their CIDRs) |

**Expected matrix** (to be confirmed by measurement):

| | `TRUST_PROXY=false` | `TRUST_PROXY=1` | `TRUST_PROXY=loopback` |
|---|---|---|---|
| A rewrites | Shared bucket (fails; demonstrates the risk) | Works **only if** Next.js appends XFF | Works if XFF is appended; spoof check uses the LAN client |
| B route handler | Shared bucket | Works (we append the address) | Works |

**Decision rule:**
- Choose **A** if `A × 1` (or `A × loopback`) passes T5.2–T5.5 and all of T2 and T6. Otherwise choose **B**.
- The backend-owner recommendation is the configuration that passed, re-confirmed in T5.7.

Also record the registration (3 per hour) and school-creation (1 per 24 h) limiters with one T5.3/T5.4 pair each, so all three limiters are confirmed through the proxy.

### T6. CORS and proxy behaviour

| Id | Env | Steps | Expected |
|---|---|---|---|
| T6.1 | E1 | Normal app usage | No preflights. No `Access-Control-*` headers are needed or relied on. |
| T6.2 | E1 | From the app origin, call the backend **directly**: `fetch('http://127.0.0.1:4010/api/admin/me', {credentials:'include'})` | 401 or a CORS failure. The frontend cookie is not sent to the backend host. This confirms the browser must use `/api` on the frontend. |
| T6.3 | E1, E2 | Header passthrough: `POST /api/timetable-generations` (E1, a READY DRAFT year if the seed has one; otherwise a mocked equivalent) → read `Location`. On E2 set `SOLVER_QUEUE_MAX=1` with the runner disabled, then queue two runs in two years to force a 503 → read `Retry-After`. | Both headers are readable by `fetch` through the forwarding layer. *(Leaves QUEUED runs, so reseed afterwards.)* |
| T6.4 | E2 | CSRF: from a page served at a **different site** (`http://127.0.0.1:5999`), auto-submit a `<form method=POST action="http://localhost:3000/api/admin/logout">` and a `text/plain` POST to `/api/subjects` | The cookie is **not** sent (`SameSite=Strict`), so the session survives and the subject write gets 401 |
| T6.5 | E2 | Cross-site read: from the same foreign page, `fetch('http://localhost:3000/api/admin/me', {credentials:'include'})` | The response is unreadable (no ACAO on the frontend) and the cookie is not sent |
| T6.6 | E1 | Large and slow requests: bulk create with 100 teachers; a generation POST; candidates for a busy day | No proxy timeout or body-size error |
| T6.7 | E1 | Backend down (`e2e.sh stop`) | The proxy returns 5xx or a network error. The UI shows the generic "Can't reach the server" message, not a raw error body. |

### T7. Unauthorised and forbidden responses

| Id | Env | Steps | Expected |
|---|---|---|---|
| T7.1 | E1 | No cookie → `GET /api/teachers` | 401 `"Authentication required"` |
| T7.2 | E1 | Garbage cookie → `GET /api/teachers` | 401 `"Invalid or expired session"` |
| T7.3 | E1 | No cookie → `POST /api/grades` with a malformed body | **400 `{message}`** before auth (documented backend behaviour). The UI must not treat it as "authenticated". |
| T7.4 | E1 | **(Creates a second school in the disposable DB, approval needed.)** School B admin requests School A's `GET /api/academic-years/<A-year>` and `PATCH /api/teachers/<A-teacher>` | **403**. The UI renders "Not found" (it never says "belongs to another school"). |
| T7.5 | E1 | An unknown UUID | 404 → not found |
| T7.6 | E1 (mocked) | A 500 whose body contains a stack or path (the shape seen in `BACKEND-OWNER-REQUEST.md` §2) | The UI shows only the generic message. The body is never displayed or logged to the console in full. |
| T7.7 | E1 | A COMPLETED or ACTIVE year: attempt each gated write through the API | 400/409 with the backend messages. The UI had already disabled those controls with an explanation. |

## 3. Exit criteria for Phase 1

1. T1–T4, T6 and T7 pass in E1 and E2. Any failure is fixed, or recorded as an accepted finding signed off at review.
2. **T5 identifies a forwarding option and `TRUST_PROXY` setting under which client IPs are distinct and the spoof is rejected.** If none passes, implementation stops and the finding is escalated.
3. The results file exists with evidence, and the `TRUST_PROXY` recommendation has been sent to the backend owner (`BACKEND-OWNER-REQUEST.md` §1).
4. T5.7 (staging) is scheduled before go-live. Go-live is blocked until it passes.

## 4. Automation

- **Playwright `e2e/real/auth.spec.ts`:** T1, T2, T4.3–T4.5, T6.1–T6.2 and T7 run in E1. A project variant runs them in E2.
- **`e2e/real/ip-propagation.mjs`:** T5. A Node script using `curl` for address control, which reads the E2 backend log and writes a Markdown table into the results file.
- **Mocked Playwright:** T4.6, T7.6.
- **Manual with checklist:** T5.6 header capture and E3 staging.
