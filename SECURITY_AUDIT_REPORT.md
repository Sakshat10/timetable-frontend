# Security Audit Report — Timetable Maker

| | |
|---|---|
| **Date** | 2026-11-27 |
| **Scope** | `timetable-frontend` (Next.js 16.4.6, branch `ui-fix`) and `timetable-backend` (Fastify 5 + Prisma 7 + PostgreSQL, commit `64b3923` plus uncommitted working-tree edits) |
| **Method** | Code review of both codebases (frontend fully; backend core in full, the 18 domain modules traced handler → service for tenant isolation), dependency audit, and controlled live testing against the **disposable e2e stack only** (Next.js test server :3100 → backend :4010 → database `timetable_dashboard_e2e_test`). No production system, port 4000 backend, Neon database or real user data was touched. |
| **Constraint** | The backend is frozen for the frontend team (`docs/architecture/BACKEND-OWNER-REQUEST.md`). Backend findings are reported with remediations but **were not changed**. Frontend findings were fixed. |

---

## 1. Executive summary

The application is in good security shape. No CRITICAL or HIGH issue was found in application code.

- **Authorization is consistently enforced on the server.** I traced every endpoint of the 18 backend modules: every ID from params, query or body is checked against the session's school before use. No IDOR and no mass assignment were found. The e2e test T7.4 confirms cross-school refusal at runtime.
- **The classic injection classes are closed.**
  - SQL: only tagged-template raw SQL is used.
  - XSS: no HTML sinks, and the script CSP is nonce-based and strict.
  - CSRF: the session cookie is SameSite, a same-origin guard runs on the proxy, and CORS is pinned to one origin.
  - RCE: the solver is spawned without a shell, with fixed arguments.
- Authentication and session design are sound. Session tokens are 256-bit and stored as hashes, passwords use PBKDF2-SHA512 (220k iterations) with constant-time comparison, the setup token is single-use and claimed atomically, and the cookie is HttpOnly and never readable by JavaScript.

**Findings: 0 critical, 0 high, 4 medium, 11 low, plus informational notes.**

| ID | Severity | Where | Title | Status |
|---|---|---|---|---|
| F-1 | MEDIUM | frontend | Open redirect after sign-in (`?next=` with tab/newline/backslash) | **Fixed + tests** |
| B-1 | MEDIUM | backend | One school can fill the generation queue shared by every school (cross-tenant DoS) | Reported |
| B-2 | MEDIUM | backend | Login timing reveals which admin emails exist in a school | Reported (measured) |
| B-3 | MEDIUM | backend | Vulnerable runtime dependencies (`zod`, `fast-uri`, `fastify`) | Reported |
| F-2 | LOW | frontend | Same-origin guard skipped for `/api` paths ending in a static-file extension | **Fixed + test** |
| F-3 | LOW | frontend | Vulnerable build-time dependency (`shadcn` → `minimatch`) | **Fixed** |
| B-4 | LOW | backend | Raw Prisma error text can reach the client from session validation | Reported (already in owner request #2) |
| B-5 | LOW | backend | Solver stderr is returned to clients in `failure.message` | Reported |
| B-6 | LOW | backend | `Secure` cookie flag depends on `NODE_ENV === "production"` exactly | Reported |
| B-7 | LOW | backend | Swagger UI and the OpenAPI document are always served; default bind is `0.0.0.0` | Reported |
| B-8 | LOW | backend | DRAFT-only rule can be raced (check, then act) | Reported |
| B-9 | LOW | backend | Academic-year lifecycle not enforced (several ACTIVE years; ACTIVE dates editable) | Reported |
| B-10 | LOW | backend | Case-insensitive stream-name uniqueness checked only in the app | Reported |
| B-11 | LOW | backend | No rate limit on expensive authenticated endpoints; all tenants share one 10-connection pool | Reported |
| B-12 | LOW | backend | Brute-force protection is per-IP, in memory only, and the school-creation limit is temporarily relaxed | Reported |

---

## 2. Architecture and attack surface

```
Browser ──HTTPS──▶ [trusted front proxy / LB: TLS, HSTS, X-Forwarded-For]
                      │
                      ▼
              Next.js (frontend origin)
              ├─ src/proxy.ts: same-origin guard on /api/*, CSP nonce + optimistic session check on pages
              ├─ rewrites(): /api/:path* ──▶ Fastify (BACKEND_URL, server-only)
              └─ Server Components: serverGet() ──▶ Fastify (forwards ONLY session_token)
                                                     │
                                                     ▼
                                     Fastify (authMiddleware → school-scoped services)
                                     ├─ Prisma / pg pool (max 10) ──▶ PostgreSQL
                                     └─ child_process.spawn(python solver, shell:false) — stdin/stdout JSON
```

**Trust boundaries**
1. **Browser → Next.js.** Everything the browser sends is untrusted: URLs, `?next=`, headers, bodies. Next.js is a forwarding layer, not an authority. Its page gate is optimistic, and the authoritative check is `GET /api/admin/me`.
2. **Next.js → Fastify.** Fastify does its own authentication and authorization on every request. It must not be directly reachable (see B-7 and owner request #1, TRUST_PROXY).
3. **Fastify → solver process.** The problem goes in as data on stdin. There is no shell and no user-controlled argv.
4. **Tenant boundary.** The school is the tenant. `request.admin.schoolId` comes from the session row and never from the request.

**Entry points**
- **Public:**
  - `POST /api/schools` (self-service school creation; returns a one-time setup token)
  - `POST /api/admin/register` (setup token required)
  - `POST /api/admin/login`
  - `POST /api/admin/logout`
  - `GET /health`
  - `GET /docs*` (backend only)
- **Authenticated:** about 90 routes across 18 modules. All of them use `authMiddleware` (verified by route inventory).
- **Frontend pages:** `/`, `/login` and `/signup` are public. Everything else is gated.

**Data flows of note**
- The session cookie `session_token` is HttpOnly, SameSite (`strict` in production), path `/`, with a 7-day absolute expiry. Only its SHA-256 hash is stored.
- The setup token lives in React component memory only and is dropped after login.
- `localStorage["tt.lastSchoolId"]` holds the school UUID. It is an identifier, not a credential.
- The `tt_year` cookie holds the last academic-year UUID. It is a preference and is checked against the API list before use.

**Secrets handling.** `.env*` is git-ignored in both repos, and only `.env.example` files are tracked. A pattern scan of tracked files found no credentials. `COOKIE_SECRET` and `TRUST_PROXY` fail closed at startup outside development and test. `BACKEND_URL` is server-only, with no `NEXT_PUBLIC_*` API URL.

---

## 3. Findings

### F-1 — MEDIUM — Open redirect after sign-in — **FIXED**

- **File:** `src/lib/safe-redirect.ts:2-7` (before the fix); used by `src/features/auth/login-form.tsx:59`.
- **Description.** `safeNextPath` rejected `//host` and `/\host` by prefix only. Per the WHATWG URL standard, browsers remove TAB, LF and CR from anywhere in a URL, so `"/\t/evil.example"` passed the check and resolved to `//evil.example`, which is another host. CWE-601.
- **Exploit (authorized test).** A phishing link such as `https://app/login?next=%2F%09%2Fevil.example%2Fsignin` shows the genuine login page. After a successful real sign-in, the browser is sent to the attacker's look-alike page ("your session expired, sign in again"), which harvests credentials.
- **Impact.** Credential phishing that is made credible by the genuine domain and a genuine login.
- **Evidence.**
  - Node's `URL` parser: `/\t/evil.example`, `/\n/evil.example` and `/\r/evil.example` all pass the old guard and resolve to host `evil.example`.
  - In Chromium against :3100, the new e2e test T1.5 run against the old code failed with `net::ERR_FAILED`: the browser navigated to `evil.example`, which the test intercepts and aborts. Against the fixed code it passes.
- **Reproduce.** Open `/login?next=%2F%09%2Fevil.example` and sign in. On the old code the browser leaves the application.
- **Fix.**
  - Any control character or backslash is refused.
  - The value must start with a single `/`.
  - The value must still resolve to the same origin through `new URL()`.
  - `/login`, `/signup` and `/api/` are refused in any letter case (`/LOGIN` previously slipped through).

### F-2 — LOW — Same-origin guard skippable for `/api/*.png`-style paths — **FIXED**

- **File:** `src/proxy.ts:52-55` (before the fix).
- **Description.** The proxy matcher excluded every path ending in `.svg`, `.png`, `.jpg`, `.woff2` and similar so that static assets skip the proxy. That exclusion also applied to `/api/...`, so such requests bypassed the cross-site write guard and were forwarded to Fastify.
- **Evidence.** `curl -X POST :3100/api/admin/logout.png -H 'Sec-Fetch-Site: cross-site'` returned the **backend's** 404 instead of the guard's 403. After the fix it returns 403 with `X-Blocked-Reason: cross-origin`.
- **Impact today.** None that could be exploited. No state-changing backend route matches such a path, because path parameters are UUID-validated and Fastify 5 does not treat `;` as a delimiter. However, it was a gap in a security control, and any future route with a free-form trailing segment would have been exposed.
- **Fix.** The matcher now lists `/api/:path*` first, so `/api` is never excluded. Static assets are still excluded, which was verified.

### F-3 — LOW — Vulnerable dependency (`minimatch` ReDoS via the `shadcn` CLI) — **FIXED**

- **Where:** `package-lock.json`. The chain is `shadcn` → `ts-morph` → `@ts-morph/common` → `minimatch` (GHSA-g3hv-75wg-m249).
- **Impact.** This is build- and CLI-time only. The app imports only `shadcn/tailwind.css`, and the vulnerable code never runs in the app's runtime.
- **Fix.** I ran `npm audit fix`, which moved `shadcn` from 4.23.0 to 4.23.1 (lockfile only; the `^4.23.0` range already allows it). The fix plan briefly listed `cn`. I verified it: it is a shadcn-maintained dependency that was already present, not a new package. `npm audit` now reports 0 vulnerabilities.

### B-1 — MEDIUM — Cross-tenant denial of service of timetable generation

- **File:** `src/modules/timetable-generation/timetable-generation.run-repository.ts:109-110`, and `runner-config.ts:56` (`queueMax: 10`).
- **Description.** The queue limit counts `QUEUED`/`RUNNING` runs across **all schools**. The only per-tenant limit is one active run per academic year, and nothing limits the number of years per school.
- **Exploit (authorized test).** An admin of school A:
  1. Creates 10 DRAFT years with the smallest READY configuration.
  2. Queues a run for each year (`POST /api/timetable-generations`).
  3. Re-queues each run as it finishes (runs last up to 300 s each).

  Every other school then gets `503 The timetable generation queue is full`.
- **Impact.** Availability of the product's core feature for all customers. Anyone can do this, because school sign-up is self-service.
- **Remediation.** Count active runs per school inside `enqueue` (`... AND "schoolId" = ${input.schoolId}`), for example a maximum of 2 per school, in addition to the global cap. Consider fair (round-robin per school) dequeueing.

### B-2 — MEDIUM — Account enumeration through login timing

- **File:** `src/modules/admin/admin.service.ts:89-92`.
- **Description.** For an unknown `(schoolId, email)` the 401 is returned at once. For a known email, PBKDF2 (220k iterations) runs first. The messages are identical, but the timings are not.
- **Evidence (measured on :4010, 4 attempts).**

  | Attempt | Response time |
  |---|---|
  | Known email, wrong password | 0.228 s, 0.053 s |
  | Unknown email | 0.0017 s, 0.0024 s |

- **Impact.** Given a school UUID, an attacker can confirm which emails are admins, which helps targeted phishing and password spraying. It is limited by the 5-per-15-minutes per-IP login limit.
- **Remediation.** When no admin is found, still call `verifyPassword(password, DUMMY_HASH)`, using a precomputed hash with the current iteration count, then throw the same 401.

### B-3 — MEDIUM — Vulnerable runtime dependencies (backend)

- **Where:** `npm audit` in `timetable-backend` reports 11 issues (1 low, 4 moderate, 6 high). All have non-breaking fixes (`npm audit fix`).
- **Runtime-relevant:**
  - `zod` (high, GHSA-mrhx-c7xc-m3w5): memory exhaustion while validating oversized constrained collections. Every request body is validated with zod. The default 1 MB Fastify body limit bounds it but does not remove it.
  - `fast-uri` (moderate, several advisories, used by Ajv format validation).
  - `fastify` (low, GHSA-389g-gv7q-r4x8: header validation bypass via case-sensitive `propertyNames`).
- **Tooling only:** `prisma` → `@prisma/config` → `effect`/`deepmerge-ts` (high), and `mysql2` (high; not used with PostgreSQL).
- **Remediation.** Run `npm audit fix` in the backend, then run its regression scripts.

### B-4 — LOW — Raw Prisma error text can leak from session validation

- **File:** `src/modules/admin/admin.service.ts:147-158`, called from `src/middleware/auth.middleware.ts:26`. No `setErrorHandler` exists.
- **Description.** `adminSession.delete`/`update` by id throws P2025 when two requests race on the same just-expired cookie, or race a logout. The error reaches Fastify's default handler, which returns `{statusCode:500, message: error.message}`. That message can include an internal source path and query detail. A database outage leaks the same way.
- **Status.** Confirmed by code reading. I did not reproduce it at runtime, because that needs direct SQL on the e2e database, which is outside my standing approval. The frontend already shows only a generic message (e2e T7.6). This is already filed as **owner request #2**.
- **Remediation.** Use `deleteMany`/`updateMany` in `validateSession` and wrap the middleware in try/catch → `handleError`. Add a global `app.setErrorHandler` that never echoes unexpected error messages.

### B-5 — LOW — Solver stderr is returned to clients

- **Files:** `src/modules/timetable-generation/timetable-generation.solver-client.ts:258-266` (stores `… (last stderr line: ${detail})` in the failure message), and `timetable-generation.schema.ts:145` (returns `failure.message` as is).
- **Impact.** When the solver crashes, the tail of a Python traceback, which may include server file paths, is shown to the school admin. This contradicts the route's own documentation.
- **Remediation.** Keep the stderr tail in the internal diagnostics only, under a key that `publicDiagnostics` hides.

### B-6 — LOW — `Secure` cookie flag tied to `NODE_ENV === "production"`

- **File:** `src/modules/admin/admin.controller.ts:75-80`.
- **Description.** `src/config/security.ts` treats **any** `NODE_ENV` other than `development`/`test`, including an unset one, as production and fails closed. The cookie code instead sets `Secure` and `SameSite=Strict` only when the value is exactly `"production"`. A deployment with `NODE_ENV` unset passes the startup checks but sends a non-Secure, Lax session cookie.
- **Remediation.** Derive the cookie flags from `!isRelaxedEnvironment(process.env.NODE_ENV)`.

### B-7 — LOW — Swagger UI always exposed; default bind is `0.0.0.0`

- **Files:** `src/config/swagger.ts:56-65`, `src/server.ts:9`.
- **Evidence.** `GET :4010/docs/json` returns 200. It is **not** reachable through Next.js, because only `/api/*` is rewritten.
- **Impact.** If Fastify is reachable directly, the full API map is public. Direct reachability also defeats `TRUST_PROXY=1` (owner request #1).
- **Remediation.** Register Swagger only in relaxed environments or behind a flag. Default `HOST` to `127.0.0.1` or a private interface, and firewall the backend so only Next.js can reach it.

### B-8 — LOW — DRAFT-only rule can be raced

- **Files** (check outside a transaction or lock, then write):
  - `grade.service.ts:28→64` and `170→222`
  - `stream.service.ts:75→114` and `179→228`
  - `section.service.ts:104→152` and `265→318`
  - `subject-requirement.service.ts:143`, `318`, `368`
  - `section-subject-teacher.service.ts:259`, `428`, `461`
  - `teacher-subject-grade.service.ts:78`, `141`
  - `curriculum.service.ts:138`, `238`
- **Impact.** The configuration of a year can change while it is being activated. This stays within the caller's own school. Schedule-config, grade-structure and record-deletion already use the correct pattern (`SELECT … FOR SHARE` plus a re-check inside the transaction), and the remediation is to reuse it.

### B-9 — LOW — Academic-year lifecycle not enforced

- **File:** `academic-year.service.ts:113-152` and `164-201`.
- **Description.** "Only one ACTIVE year per school" is not enforced, either in code or by a partial unique index. Dates of ACTIVE or COMPLETED years can be edited.
- **Impact.** Overlapping years make `substitution.sync.ts:38-41` (`versionOnDate`) return `AMBIGUOUS`, and **cover requests for those dates are then silently not created**.
- **Remediation.** Add a partial unique index `(schoolId) WHERE status = 'ACTIVE'`, use a conditional `updateMany` for status transitions, and freeze dates outside DRAFT.

### B-10 — LOW — Stream-name uniqueness race

- **File:** `stream.service.ts:100-112` and `192-201`.
- **Description.** The check is a case-insensitive `findFirst`, then a write, and the database has no constraint on the name. Two concurrent requests for "Science" and "science" both succeed.
- **Remediation.** Add a unique index on `(gradeId, lower(name))`.

### B-11 — LOW — No rate limit on expensive authenticated endpoints

- **Description.** The following endpoints are heavy, and some write data even on GET:
  - `/timetable-feasibility` (max-flow)
  - `/timetable-versions?includeStaleness=true`
  - `/timetable-versions/:id/validation`
  - `GET /substitutions*` (each call syncs every active absence in a write transaction)

  All tenants share one pg pool with a maximum of 10 connections (`config/database.ts`).
- **Impact.** One admin can degrade service for everyone.
- **Remediation.** Add a per-session or per-school limiter on these routes, or enforce limits at the front proxy.

### B-12 — LOW — Brute-force protection limits

- **File:** `src/middleware/rate-limit.middleware.ts`.
- **Description.**
  - Login is limited to 5 attempts per 15 minutes **per IP**, in process memory. There is no per-account lockout or back-off, so distributed spraying is not slowed, and counters reset on restart.
  - The backend working tree has an **uncommitted** change raising the school-creation limit from 1 to 3 per 24 hours ("temporarily raised"). Make sure it is not deployed by accident.
- **Remediation.** Add a per-`(schoolId, email)` failure counter with exponential back-off, and move the counters to a shared store (or the proxy) before running more than one instance.

### Informational

**Frontend**
- **I-1** `/api` responses do not carry the `nosniff`/`X-Frame-Options` headers, because `next.config.ts` `headers()` does not apply to rewrites to an external backend. The responses are JSON with a correct content type, so the risk is negligible.
- **I-2** `style-src 'unsafe-inline'` is deliberate and documented (Radix/Sonner inject styles). Scripts are nonce-only.
- **I-3** HSTS is expected at the TLS-terminating proxy. Verify this in deployment.

**Backend**
- **I-4** Ownership helpers return 403 for another school's record and 404 for a missing one. This is an existence oracle, but over random v4 UUIDs, so it cannot be used in practice.
- **I-5** `school.service.ts:56` fails open if the `authMiddleware` preHandler is ever removed. It is safe today.
- **I-6** `handleError` reveals the column name on P2002 conflicts ("`code` already exists").
- **I-7** Sessions have a 7-day absolute expiry with no idle timeout. Expired rows are deleted only when they are used, and no sessions are revoked at login.
- **I-8** `teacher_bulk_requests` rows (each holding a full response JSON) are never pruned.
- **I-9** A DRAFT version can be deleted in a COMPLETED year. This is probably intended.
- **I-10** If the tab is closed between school creation and admin registration, the setup token is lost and only operator recovery (`npm run setup-token`) helps. This is by design and documented.

### Verified secure (tested, no finding)

| Area | Result |
|---|---|
| SQL/NoSQL injection | Raw SQL uses Prisma tagged templates only. The single `$executeRawUnsafe` interpolates a constant. |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML` or `eval`. Links are built from backend UUIDs. Nonce + `strict-dynamic` CSP with no CSP violations in the signed-in app (e2e). |
| CSRF | SameSite cookie, the proxy same-origin guard (form/no-cors/preflight cases covered in e2e), CORS pinned to one origin with no reflection (probed), and JSON-only bodies. |
| Authentication / session | HttpOnly cookie, hashed 256-bit tokens, PBKDF2-SHA512 220k with `timingSafeEqual`, the setup token claimed atomically in one UPDATE, logout deletes the server row (e2e T1.4), and an expired or invalid cookie never renders protected content (T4.5). |
| Access control / IDOR / privilege escalation | All 18 modules are scoped to the session's school, including IDs referenced in bodies, bulk, copy and clone. There is a single admin role, so no vertical escalation path exists. `POST /admins` rejects `schoolId` in the body (strict schema). Runtime cross-school refusal is covered by e2e T7.4. |
| Mass assignment | No request body is spread into Prisma writes. |
| RCE | `spawn(python, [fixed entrypoint], {shell:false})`. Input goes in as stdin JSON. |
| SSRF | There are no user-controlled outbound requests. `BACKEND_URL` is server-side configuration, validated. |
| Path traversal / file upload | Neither feature exists. |
| JWT | Not used (opaque session tokens). |
| Input bounds | Bulk arrays are capped (20–200), and list limits are capped at 100. |
| Error leakage (frontend) | Only the generic message is shown for 5xx (e2e T7.6). |
| Secrets | None in tracked files. Startup validation is fail-closed. |

---

## 4. Fixes implemented (frontend)

| File | Change |
|---|---|
| `src/lib/safe-redirect.ts` | Refuses control characters and backslashes, requires a same-origin resolution through `new URL`, and refuses auth/API targets in any letter case (F-1). |
| `src/proxy.ts` | The matcher adds `/api/:path*` so the same-origin guard can never be skipped by extension (F-2). |
| `package-lock.json` | `shadcn` 4.23.0 → 4.23.1 through `npm audit fix` (F-3). |
| `docs/architecture/BACKEND-OWNER-REQUEST.md` | Added the backend findings of this audit for the backend owner. |

## 5. Security tests added

| Test | Covers | Proven to fail on old code |
|---|---|---|
| `src/lib/safe-redirect.test.ts` (5 unit tests) | Tab/LF/CR/NUL/backslash bypasses, absolute and protocol-relative URLs, auth/API targets in any letter case, legitimate paths kept | Yes: 2 of 5 fail against the previous implementation |
| `e2e/auth.spec.ts` › T1.5 | Real browser: a sign-in with `next=/\t/evil.example`, `/\n/…` or `/\evil.example` stays on the app | Yes: the old code navigated to `evil.example` |
| `e2e/security.spec.ts` › "guard also covers /api paths that look like static files" | Cross-site POST to `/api/…/x.png`, `.svg` and `.woff2` → 403 from the guard | Yes: the old code forwarded these to the backend (404 from Fastify) |

## 6. Verification performed

| Check | Result |
|---|---|
| `npm run verify` (typecheck + lint + unit tests) | Pass. 17 files, **187 tests** pass. |
| `npm audit` (frontend) | **0 vulnerabilities** (was 4 moderate). |
| e2e `security.spec.ts` + `boundaries.spec.ts` (real backend :4010) | **36/36 pass.** |
| e2e `auth.spec.ts` (real backend :4010) | **14/14 pass** (includes cross-school refusal T7.4). |
| `next build` (isolated dist dir) | Pass. The proxy compiles with the new matcher. |
| Live re-probe of F-2 on :3100 | Cross-site `.png` POST → 403. Same-origin → passes through. Static assets → 200. |

**Not verified**
- The full e2e suite was not run. Only the security-relevant specs were run (security, boundaries, auth).
- B-4 was not reproduced at runtime.
- No backend fix was applied or tested. The backend is frozen for this team.
- Deployment configuration (TLS/HSTS at the proxy, network isolation of Fastify, `TRUST_PROXY`, `NODE_ENV`) cannot be checked from the repositories.

## 7. Remaining risks and recommended order

1. **B-1** Add a per-school cap on generation runs. This is the only cross-tenant impact found.
2. **B-3** Run `npm audit fix` in the backend.
3. **B-2** Run a dummy hash on unknown login emails.
4. **Deployment:** make Fastify reachable only from Next.js, set `TRUST_PROXY=1` behind a trusted XFF-writing proxy, and set `NODE_ENV=production` explicitly (B-6, B-7, owner request #1).
5. **B-4/B-5** Close the two error-leak paths and add a global error handler.
6. **B-9 → B-8 → B-10** Enforce the year lifecycle and the DRAFT-only rule with database constraints and row locks.
7. **B-11/B-12** Add rate limiting on expensive routes and per-account login back-off; revert the temporary school-creation limit.

## 8. Final assessment

The frontend is **ready from a security standpoint** after these fixes: its one exploitable issue (F-1) is closed and covered by regression tests.

The backend's core controls are strong: authentication, tenant isolation, injection resistance and secret handling. The remaining backend work is availability (B-1, B-11), enumeration hardening (B-2), dependency hygiene (B-3) and integrity under concurrency (B-8 to B-10). None of these allows one school to read or modify another school's data.
