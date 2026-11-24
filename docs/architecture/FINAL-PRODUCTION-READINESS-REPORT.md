# Timetable Maker 2.0: final production-readiness report

- **Audit date:** 2026-11-24.
- **Frontend:** `main` @ `20259b5`, 11 commits, working tree clean.
- **Backend:** `timetable-backend` @ `64b392390cd45af97246478a5235d754fa3b59f6`, unchanged, working tree clean.
- **Environment:** the Next.js test server on :3100 (`next dev`), in front of the disposable backend on :4010 (database `timetable_dashboard_e2e_test`).
- **Scope:** a QA and security review. No application code was changed during this audit.
  - Throwaway check scripts ran from the session scratchpad, outside the repository.
  - No migrations were run, Neon was not accessed, and the disposable database was not reset.
  - No test server was stopped, and no history was rewritten.

> **Updated 2026-11-24 after the release-hardening phase.** Sections 1–10 below are the original audit, kept as
> written. **Section 0 supersedes them** wherever they differ: the current status, the fixed findings, the new
> tests and their actual results.

## 0. Release-hardening update (current status)

**Status: GO for staging. NO-GO for production.**

The frontend-owned P1 items are now fixed, and the untested refusal branches are covered. Production stays blocked only by the P0 items, which are backend, deployment and staging work (§0.5); none is frontend-owned.

### 0.1 Findings fixed (frontend)

| ID | Finding | Fix | Verified by |
|---|---|---|---|
| S3 | **Forced-logout CSRF** | `src/proxy.ts` now runs on `/api/*` and applies `checkApiRequest` (`src/lib/security/same-origin.ts`) to state-changing requests (POST, PUT, PATCH, DELETE):<br>• **`Sec-Fetch-Site`:** allowed only when it is `same-origin`.<br>• **`Origin`** (used when Fetch Metadata is absent): allowed only when its host equals the request's `Host` or `X-Forwarded-Host`.<br>• **Neither header:** allowed, because the request comes from a non-browser client with no ambient cookies.<br>Blocked requests get 403 with `X-Blocked-Reason: cross-origin` and never reach the backend. Safe methods are not blocked (CORS stops cross-site reads), and server-side calls go straight to the backend. | Unit tests: 8 cases. E2E `[real]` in `e2e/security.spec.ts`:<br>• a cross-site form POST to logout gets 403, no `Set-Cookie`, and the session survives;<br>• a cross-site form POST and a no-cors POST get 403, and nothing is created;<br>• cross-site DELETE and credentialed reads fail;<br>• same-origin and non-browser writes still reach the backend.<br>Also checked against the production build (`next start`) with curl. |
| S4 | **No CSP** | A per-request nonce CSP is built in `src/lib/security/csp.ts` and set by the proxy:<br>• **Scripts:** `script-src 'self' 'nonce-…' 'strict-dynamic'`, with no `unsafe-inline`; `unsafe-eval` only in development.<br>• **Styles:** `style-src 'self' 'unsafe-inline'`. A deliberate, documented choice: Sonner and Radix inject `<style>` elements and React uses style attributes, and none of these can carry a nonce.<br>• **Everything else:** `default-src`, `connect-src`, `font-src`, `base-uri` and `form-action` are `'self'`; `object-src 'none'`; `frame-ancestors 'none'`.<br>• **Rendering:** the root layout reads headers, so every route renders per request (required for nonces), and passes the nonce to the theme script.<br>• **Zod:** `jitless` is set so Zod's `new Function` probe no longer raises a violation under the strict CSP. | E2E: the CSP is strict with a fresh nonce on every request; every server-rendered `<script>` carries the nonce; no CSP violations on signed-in pages.<br>Production build: **0 violations** on 7 pages, with no console errors and working interaction. |
| A1 | Year switcher accessible name | Removed the `aria-label`. The name is now the visible text plus a screen-reader-only ", change academic year". | axe + `a11y.spec.ts` |
| A2 | Schedule day button names | The name is now "Mon (Monday)", so it starts with the visible text. | axe |
| A3 | Contrast | The light `--destructive` token is darkened to `oklch(0.46 0.19 27)`. The 0.50 value tried first still measured 4.41:1, so it was darkened again and re-measured. The "Free" cell now uses full `muted-foreground`. | axe: no `color-contrast` violations |
| A4 | No skip link | Added "Skip to main content", the first Tab stop, which focuses `#main`. | `a11y.spec.ts` keyboard test |
| A5 | axe not automated | New `e2e/a11y.spec.ts`: WCAG 2.0/2.1 A and AA; fails on serious or critical violations; waits for animations to finish before scanning. Covers 15 routes, teacher detail, the class and teacher timetable views, two open dialogs, and the signed-out login and signup pages. | 21 tests |
| New | **Session-expiry redirect could be superseded** (found while stabilising T4.2) | The client-side `router.replace` redirect could be overtaken by a link navigation started at the same moment. That left the user on a page with an expired session while the one-shot signal was already spent. The redirect is now a full-page `window.location.replace`, which can't be superseded and resets all state. The login page's "Your session ended" banner is the single notice. | `auth.spec.ts` T4.2/T4.6 |

### 0.2 Tests added

Test titles state whether they are `[real]` (the real backend produced the response) or `[mocked]` (`page.route` on `/api/` only).

| Spec | Tests | Real | Mocked | Covers |
|---|---|---|---|---|
| `e2e/security.spec.ts` | 5 | 5 | 0 | Cross-site CSRF, legitimate writes, CSP strictness, CSP violations (§0.1) |
| `e2e/a11y.spec.ts` | 21 | real backend data | – | Accessibility and keyboard (§0.1) |
| `e2e/timetable-refusals.spec.ts` | 22 | 11 | 11 | See the breakdown below |
| `e2e/absence-conflicts.spec.ts` | 7 | 6 | 1 | See the breakdown below |
| `src/lib/security/same-origin.test.ts` | 8 (unit) | – | – | The guard decision matrix |

**`e2e/timetable-refusals.spec.ts`**
- **TEACHER_BUSY [real], closing F4.** Run in the UI on a deterministic setup: one teacher pinned to both sections of the spec's own year.
- **Other editor refusals:**
  - ENTRY_LOCKED [real], in the API and the UI;
  - INVALID_SLOT, INVALID_MOVE, INVALID_SWAP, REVISION_CONFLICT and VERSION_NOT_DRAFT, as [real] API contract checks;
  - INVARIANT_VIOLATION and SNAPSHOT_UNUSABLE [mocked].
- **Generation refusals:**
  - existingRunId [real]: the UI adopts the backend's run;
  - not-DRAFT [real];
  - DRAFT_LIMIT_REACHED, 503 with Retry-After, LOCKS_INVALID, an uncertain start (exactly one POST, then adoption from the list) and NOT_READY [mocked].
- **Publish refusals:**
  - PUBLISHED_CHANGED, a revision conflict and a stale draft [real];
  - STALE_CONFIGURATION, VALIDATION_FAILED, an uncertain outcome and VERSION_NOT_DRAFT treated as success [mocked].
- **Archived deletion:**
  - typed-confirmation delete with the exact request body [real];
  - VERSION_HAS_HISTORY [real];
  - CONFIRMATION_MISMATCH and STATUS_CHANGED [mocked].

**`e2e/absence-conflicts.spec.ts`**
- **[real]:** TEACHER_IS_COVERING, ASSIGNED_COVERS_EXIST, ASSIGNED_COVERS_OUTSIDE, ABSENCE_OVERLAP (with a link to the existing absence), UNAVAILABILITY_EXISTS, and ALREADY_COVERING on the cover sheet.
- **[mocked]:** REPLACEMENT_ALREADY_BOOKED and FOUR_CONSECUTIVE_NOT_ALLOWED.
- Dates, periods and teachers are derived from the published timetable, never hard-coded.

Existing tests updated, none removed or weakened:
- **`overview-settings.spec.ts`:** the year-switcher name regex, for A1.
- **`auth.spec.ts`:** the T4.2 click is now best-effort because the redirect can win the race. The assertions are unchanged except that the notice is now the login page's banner.

### 0.3 Actual results (2026-11-24, disposable backend :4010; the database was not reset in this phase)

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run` | **178 passed** (16 files) |
| `npm run build` (production) | success; 23 routes, all dynamic, as nonce CSP requires |
| Playwright `--project=app --project=mobile` | **141 passed, 0 failed**. Includes the boundary scan (29), accessibility (21), security (5), timetable refusals (22), absence conflicts (7) and responsive (15) |
| Playwright `--project=auth` | **13 passed, 0 failed** |
| Production build (`next start` :3300, temporary): CSP violation scan, 7 pages | **0 violations**, 0 console errors; menus open |
| Production build: guard via curl | cross-site POST → 403; same-origin POST → backend 400; client without Origin → backend 400 |

The auth project ran separately from the app/mobile run, on the same code. The backend's in-memory login limit (5 per 15 minutes) meant waiting for the window to reset instead of restarting the test backend, which this phase didn't allow.

**Test-infrastructure notes (environment, not product):**
- Chrome's Private Network Access hides cross-site requests from a "public" test origin to localhost, so the security spec uses `http://127.0.0.1:3100` as the attacker site. That is a different site from `localhost`.
- Chrome's Opaque Response Blocking fails no-cors JSON responses in the browser. The spec therefore replays the exact request the browser sent to observe the server's 403.

### 0.4 Dependency review: shadcn CLI advisories (S5)

| Item | Finding |
|---|---|
| Advisory | GHSA-g3hv-75wg-m249, moderate: minimatch DoS via glob amplification. Affects `>=7.0.0 <11.0.1` |
| Chain | `shadcn@4.23.0` (direct) → `ts-morph@26.0.0` → `@ts-morph/common@0.27.0` → `minimatch@10.2.6`. The four advisories are this one chain |
| Fix available | Upstream only: `@ts-morph/common@0.29.1` (with `ts-morph@28`) uses `minimatch ^11.0.1`. The latest `shadcn` (4.23.0) still pins `ts-morph ^26`. npm's suggested fix is a downgrade to `shadcn@1.0.0`, which isn't viable |
| Build-time or runtime | **Build and dev tooling only.** The app imports just `shadcn/tailwind.css`, a 16 KB static stylesheet compiled at build time. There is no shadcn, ts-morph or minimatch code in the client bundle (0 matches in `.next/static`) and none imported server-side. minimatch runs only when a developer uses the shadcn CLI, on project-controlled patterns |
| Decision | **No upgrade or override.** That would be unnecessary and riskier than the exposure. Track upstream `shadcn` and update when it moves to `ts-morph >= 28`. `shadcn` stays in `dependencies`, because production builds commonly install with `--omit=dev` and the CSS import must resolve |

### 0.5 Remaining items

**Backend dependencies (unchanged, BACKEND-OWNER-REQUEST.md):**
- **P0:** S1, the session-validation error leak.
- **P0:** S2, `TRUST_PROXY=1` with Fastify reachable only from Next.js.
- **Low:** S7, logout cookie attributes. S3 is now mitigated in the frontend; a backend-side defence in depth is still optional.

**Staging checks (P0, need the real deployment):**
1. T5.7: client IP through the real proxy chain.
2. T2.2: a `Secure`/`Strict` cookie in a browser over HTTPS.
3. The full Playwright suite against the staging production build, including `security.spec.ts` over HTTPS.
4. HSTS at the TLS proxy.
5. Re-verify the S1 fix once it is deployed.

**Frontend:** none outstanding at P0 or P1. P3 items remain: "forget this School ID" (S6), and a global scan for forbidden wording in non-interactive text.

### 0.6 Updated recommendation

**GO for staging. NO-GO for production** until the backend P0 items (S1, S2) are deployed and the staging checks in §0.5 pass. The frontend-owned P1 security, accessibility and test-coverage work is complete and verified.

## 1. Overall release status

| Target | Verdict |
|---|---|
| **Staging deployment** | **GO.** The functionality is complete and verified against the real backend. |
| **Production** | **NO-GO until the P0 items in §8 are closed.** They are deployment configuration, one backend fix, staging-only measurements, and the missing frontend tests and accessibility fixes listed as P1. No P0 item requires new features. |

**Evidence base.** Each was run during or immediately before this audit, and nothing is claimed that didn't run:

| Check | Result | When |
|---|---|---|
| `npm run typecheck` | exit 0 | 2026-11-24, after the last code commit |
| `npm run lint` | exit 0 | same |
| `npx vitest run` | **170 passed**, 15 files | same |
| `npm run build` (production) | success; 23 routes | 2026-11-24, before the last test-only commit |
| Playwright, full suite, fresh reseed | **99 passed, 0 failed** (setup + auth + app + mobile) | 2026-11-24 |
| Cross-site cookie and CORS probes (T6.2, T6.4, T6.5) | ran in this audit | see §4 |
| Production cookie flags through Next.js (T2.2, HTTP level) | ran 2026-11-24 | see §4 |
| axe-core WCAG 2.1 A/AA scan, 16 pages | ran in this audit | see §6 |
| Static source and client-bundle scan | ran in this audit | see §5 |
| `npm audit --omit=dev` | 4 moderate (tooling) | ran in this audit |

**Not run:**
- the e2e suite against a `next start` production build (the suite runs on `next dev`);
- any HTTPS run;
- the staging proxy chain.

## 2. Verified capabilities

### 2.1 Feature-to-API matrix (FEATURE-API-MATRIX.md)

The API surface has 99 functions in `src/lib/api/endpoints.ts`, one per audited operation. Deleting a PUBLISHED version is excluded (P6).

Usage scan: **84 are called by the UI.** The other 15 are expected to be unused:
- Detail reads (`gradesApi.get`, `streamsApi.get`, `sectionsApi.get`, `subjectsApi.get`, `assignmentsApi.get`, `scheduleApi.get`) and `gradesApi.streams`/`sections`. The pages use list or overview reads instead, which the matrix allows.
- `requirementsApi.*` (5): replaced by the curriculum editor's whole-curriculum `PUT` with a dry run.
- `authApi.me` and `schoolApi.get`: called server-side through `serverGet` in the auth gate.

| Module | Pages | Verified by |
|---|---|---|
| M1 Auth and onboarding | `/login`, `/signup`, `/setup/start` | `auth.spec.ts` (13), `overview-settings.spec.ts` |
| M2 Shell, years, settings | layout, year switcher, `/settings` | `overview-settings.spec.ts` (7). Activation's typed confirmation was verified with an intercepted PATCH; no real activation |
| M3 Classes | `/years/:id/classes` | `setup-modules.spec.ts` |
| M4 Subjects | `/years/:id/subjects` | `setup-modules.spec.ts` |
| M5 Curriculum | `/years/:id/curriculum` | `setup-modules.spec.ts` (dry run, then apply; copy) |
| M6 Teachers and eligibility | `/years/:id/teachers`, `/teachers/:id` | `teachers-assignments-schedule.spec.ts` |
| M7 Assignments | `/years/:id/assignments` | same |
| M8 Schedule | `/years/:id/schedule` | same, plus a boundary check (no time inputs) |
| M9 Readiness and generation | `/years/:id/generate` | `timetables.spec.ts`: READY, then a real CP-SAT generation |
| M10 Versions | `/years/:id/timetables` | `timetables.spec.ts`: Copy to new draft, delete a draft |
| M11 Viewer and editor | `/years/:id/timetables/:vid` | `timetables.spec.ts`: drag move, keyboard swap, locks, undo, publish |
| M12 Daily operations | `/operations`, `/operations/absences[/:id]`, `/operations/unavailability` | `operations.spec.ts` (10) |
| M13 Dashboard and setup guide | `/years/:id/dashboard`, `/years/:id/setup` | `overview-settings.spec.ts` |

### 2.2 Critical workflows (real backend, end to end)

| Workflow | Status | Notes |
|---|---|---|
| School setup (classes, subjects, curriculum, teachers, eligibility, optional pins, schedule) | **Verified** | Specs write only to their own records in the seeded DRAFT year |
| Feasibility (READY / NOT_READY with deep links) | **Verified** (READY path, live) | NOT_READY rendering is checked through the seeded draft year's dashboard and setup guide |
| Generation | **Verified** (success path, real solver) | The error branches are untested (see §7) |
| Version viewing (class and teacher views, break row) | **Verified** | |
| Supported editing (move, swap, locks, undo, revision conflict) | **Partly verified** | The REVISION_CONFLICT and SLOT_OCCUPIED refusals were simulated; **the real TEACHER_BUSY branch did not run** (§7) |
| Validation panel | **Verified** (valid case) | The invalid-timetable rendering has no e2e test |
| Publishing | **Verified** (success, in the spec's own year, with substitution summary) | The publish refusals are untested (§7) |
| Substitution (absence → covers → tiered picker → assign / replace / unassign / cancel; auto-assign) | **Verified** | The last-resort confirmation was simulated |
| Academic-year activation (irreversible) | **Verified (dialog gating only)** | No real activation was performed, by design |

### 2.3 Capability boundaries (CAPABILITY-BOUNDARIES.md)

| Check | Result |
|---|---|
| No interactive control matches the forbidden list on any of 26 page visits (both seeded years) plus the account menu | **passed** (`boundaries.spec.ts`) |
| The schedule has no time inputs and no lunch, assembly or start/end wording | **passed** |
| The published version offers no editing, export or lifecycle controls; the teacher view has no drag | **passed** (`boundaries.spec.ts`, `timetables.spec.ts`) |
| The API layer has no functions for unsupported capabilities and calls only audited endpoints | **passed** (`src/lib/api/boundaries.test.ts`) |
| No delete for the PUBLISHED version; "Copy to new draft" is never called restore | **passed** (code review and `timetables.spec.ts`) |
| Substitution history is labelled "Substitution updates" / "Cover history" | **passed** (code review and `operations.spec.ts`) |

**Boundary gap:** forbidden *wording* in non-interactive text (help text, empty states, tooltips) is checked only by per-spec `getByText` assertions on some pages. It is not covered by one global scan.

## 3. Failed or incomplete checks

| # | Check | Status | Why |
|---|---|---|---|
| F1 | T5.7: client IP through the **real** staging proxy chain | **Not run** | Requires staging |
| F2 | T2.2: `Secure; SameSite=Strict` in a **browser over HTTPS** | **Partial** | Verified at HTTP level through Next.js (`HttpOnly; Secure; SameSite=Strict`, unchanged by the proxy). No HTTPS environment locally |
| F3 | The e2e suite against a **production build** (`next start`) | **Not run** | The suite and the T5 measurement use `next dev`. The rewrite proxy code path is the same, but rendering and caching differ |
| F4 | The real **TEACHER_BUSY** editor refusal | **Not run** | The spec builds its own small school, where no busy slot occurred; it fell back to a simulated SLOT_OCCUPIED. The code maps TEACHER_BUSY (`src/features/timetables`), but no unit or e2e test covers it |
| F5 | Generation error branches (409 adopt `existingRunId`, DRAFT_LIMIT_REACHED, 503 with Retry-After, uncertain outcome, LOCKS_INVALID, SOURCE_VERSION_*) | **Unit-tested mapping only, no UI test** | Guidance mapping and run recovery are in `generation/rules.test.ts`. No spec exercises the generate page's refusal UI |
| F6 | Publish refusals (PUBLISHED_CHANGED, STALE_CONFIGURATION, VALIDATION_FAILED, VERSION_NOT_DRAFT after an uncertain outcome) | **No test** | Handled in `publish-panel.tsx` (code review) |
| F7 | Delete ARCHIVED version (typed confirmation; CONFIRMATION_MISMATCH, STATUS_CHANGED, VERSION_HAS_HISTORY) | **No test** | Handled in code (code review) |
| F8 | Editor refusals INVARIANT_VIOLATION, ENTRY_LOCKED (real), INVALID_*, SNAPSHOT_UNUSABLE | **No test** | Handled in code |
| F9 | Absence conflicts TEACHER_IS_COVERING, ASSIGNED_COVERS_OUTSIDE/EXIST; UNAVAILABILITY_EXISTS | **No test** | ABSENCE_OVERLAP is covered (operations e2e). The others are handled in code |
| F10 | T6.4 forced logout | **Finding** (§4, S3) | |
| F11 | Accessibility: serious axe violations | **Finding** (§6) | |

## 4. Authentication, cookie and proxy review

| Area | Evidence | Result |
|---|---|---|
| Login and logout | auth.spec T1.1, T1.2, T1.3, T1.4 | pass. Logout deletes the server session; replaying the old token returns 401 |
| Session persistence | T2.4 (new browser context with saved state) | pass |
| Cookie attributes, development | T2.1: `HttpOnly`, host-only `localhost`, `Path=/`, `SameSite=Lax`, about 7 days, not in `document.cookie` | pass |
| Cookie attributes, production (through Next.js) | T2.2, HTTP level: `HttpOnly; Secure; SameSite=Strict; Max-Age=604800`, unchanged by the rewrite | pass (browser and HTTPS pending: F2) |
| Session expiry | T4.1 (absolute, no sliding); T4.2/T4.6 (one redirect, one notice, row deleted) | pass |
| Route protection | Every page route without a cookie returns 307 to `/login?next=…` (curl, 9 routes); an invalid cookie never renders protected content (T4.5); the server gate re-checks `/api/admin/me` | pass |
| Unauthorised and forbidden | T7.1–T7.3 (401 messages; Ajv 400 before auth); T7.4 (another school's year: 403 from the API, "Page not found" in the UI) | pass |
| Open redirect | External and `//` values for `next` are ignored (`safe-redirect.ts`; covered by T1.1 with `//evil.example`) | pass |
| Proxy forwarding | Same-origin, no preflight (T3.1); `Set-Cookie` and request headers pass through; `/api` is reserved for the backend | pass |
| Client-IP trust | T5 (PHASE-1 results): safe only behind a trusted front proxy that writes `X-Forwarded-For`, with backend `TRUST_PROXY=1` and the backend not directly reachable | **deployment dependency** (§6, §7) |
| Cross-origin reads (T6.5) | A credentialed `fetch` from `http://127.0.0.1:5999` to `localhost:3100/api/admin/me` is blocked by CORS (TypeError) | pass |
| Direct backend calls (T6.2) | A credentialed `fetch` from the app origin to `127.0.0.1:4010` is blocked | pass |
| Cross-site form POST (T6.4) | The session cookie was **not sent** (`SameSite`), so no authenticated action can be forged. **But see S3:** the response still logs the user out | **finding S3** |

## 5. Security findings

**Severity scale:** High = exploitable, data at risk. Medium = information disclosure, or a security control that depends on configuration. Low = nuisance or defence-in-depth.

| ID | Severity | Finding | Evidence | Owner | Recommendation |
|---|---|---|---|---|---|
| S1 | **Medium** | The backend's session validation leaks raw Prisma errors (source path, code excerpt) in 500 responses when the database fails. This affects every authenticated route. | Reproduced in production mode (BACKEND-OWNER-REQUEST §2). The frontend never displays 5xx bodies (unit test, plus T7.6 e2e). | Backend | Wrap `authMiddleware` or add a `setErrorHandler`. **P0.** The frontend mitigation is in place, but the leak is reachable directly through `/api`. |
| S2 | **Medium (configuration)** | Login, registration and school-creation rate limits depend on the client IP. Through Next.js, every user shares one bucket, or can spoof their address, unless deployed as front proxy → Next.js → Fastify with `TRUST_PROXY=1` and the backend private. | T5 measurements | Deployment / backend | Configure exactly as in PHASE-1 §Decision; re-measure on staging (T5.7). **P0.** |
| S3 | **Low** | **Forced-logout CSRF.** A cross-site auto-submitted form `POST /api/admin/logout` (top-level navigation) carries no cookie, but the browser applies the response's `Set-Cookie: session_token=; Max-Age=0`. The victim is signed out on that device. Their server session stays valid and is not exposed; there's no data access and no forged action. | Audit probe: the browser cookie is gone after the attack; replaying the old token returns 200, so the server session is intact. Expected to reproduce in production (same mechanism). | Frontend and backend | Frontend (no new feature): reject cross-site requests to `/api/*` in `proxy.ts` using `Sec-Fetch-Site: cross-site` / a foreign `Origin`. Backend: clear the cookie only when a valid session cookie was presented, or require a JSON content type on logout. **P2** |
| S4 | **Low** | **No Content-Security-Policy.** FRONTEND-ARCHITECTURE §13 planned one. Present: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`. No HSTS (expected at the TLS proxy). | curl of `/login` headers | Frontend / deployment | Add a CSP in `next.config.ts` (self, with nonces as Next requires), tested against the production build. Set HSTS at the proxy. **P1** |
| S5 | **Low** | 4 moderate advisories (minimatch ReDoS) via the `shadcn` CLI → ts-morph. Tooling only, not in the client bundle, but `shadcn` is listed under `dependencies` (its CSS is imported by `globals.css`). | `npm audit --omit=dev` | Frontend | Track upstream. The CSS import only needs the package at build time, so it can move to `devDependencies` as long as the build environment installs dev dependencies. **P2** |
| S6 | Info | The last-used School ID is stored in `localStorage` (`tt.lastSchoolId`) for login convenience. It isn't a credential, but on a shared device it reveals which school was used. | `login-form.tsx` | Frontend | Acceptable. Optionally offer "Forget this School ID". **P3** |
| S7 | Info | The logout `Set-Cookie` lacks `Secure`/`Strict` in production. Clearing still works over HTTPS. | T2.2 check | Backend | BACKEND-OWNER-REQUEST "Low priority". **P3** |

**Verified secure (no finding):**
- **Secrets.** None in the source, the committed files (only `.env.example`) or the **production client bundle**. The bundle has no backend URL, no env var names, no `session_token` and no seed credentials.
- **Build output.** No source maps shipped; no server-only modules in client chunks.
- **Session token.** Only in the HttpOnly cookie. Never in JS-readable storage; `document.cookie` writes are the non-sensitive `tt_year` preference and the shadcn sidebar state.
- **Output safety.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`. Backend messages render as escaped text, and 5xx bodies are replaced with a generic message (unit test, T7.6).
- **Input handling.**
  - All path segments are `encodeURIComponent`-ed; query strings use `URLSearchParams`.
  - A malformed `?date=` (`2026-13-45<script>`) falls back to today without errors.
  - UUID route params are validated (`notFound()` otherwise).
- **No cross-session leakage.**
  - The query cache is cleared on login, signup, logout and any 401.
  - The session (admin and school) is re-read on the server per layout render.
  - A stale `tt_year` cookie from another school's year is ignored (default-year fallback).
- **Unsupported operations.** Not exposed in the UI or the API layer (§2.3).
- **Dev-only output.** `console.error` appears only for contract mismatches, outside production.

## 6. UI quality review

| Area | Result |
|---|---|
| Responsive | `responsive.spec.ts` (Pixel 7): 14 pages with no page-level horizontal scroll; the navigation drawer works. Manual screenshots at 390 px for the dashboard, teachers, assignments, curriculum, board and viewer (agent and lead checks) |
| Loading, empty, error, stale states | Present on every page (code review; e2e checks the empty and 500 states for setup modules, teachers and operations, and per-card dashboard failure) |
| Duplicate submission | `PendingButton` and `ConfirmDialog` block repeat clicks. Uncertain writes are never re-sent, and bulk teachers reuse the idempotency key (code review; no e2e double-click test) |
| Form labels | Every field uses `useId()`, after the duplicate-id defect was fixed; e2e tests drive forms by label |
| Keyboard | Login tab order is School ID → Email → Password → Sign in → Set up your school. The editor has a non-drag keyboard path (covered by an e2e swap) |

**axe WCAG 2.1 A/AA**, 16 pages. No critical violations. Serious violations:

| ID | Severity | Item | Notes |
|---|---|---|---|
| A1 | **serious** | `label-content-name-mismatch` on **every page** | The year switcher's `aria-label` "Academic year: X. Change year" doesn't contain its visible text, which breaks voice control. Fix: drop the `aria-label` or make it start with the visible text. **P1** |
| A2 | serious | `label-content-name-mismatch`, 8× on Schedule | Day toggles: visible "Mon", label "Monday". Fix: use the visible text in the name, or `aria-label="Mon (Monday)"`. **P1** |
| A3 | serious | `color-contrast` | The shadcn `destructive` button is 4.41:1 (needs 4.5:1), seen on teacher detail. The viewer's "Free" cells are 3.12:1. Fix: tokens and classes. **P1** |
| A4 | moderate (manual finding) | No skip-to-content link | The first tab stop is the sidebar school link, so keyboard users tab through about 16 navigation links on every page. Add a skip link to `#main`. **P2** |
| A5 | gap | axe is not part of the automated suite | `@axe-core/playwright` is installed but unused in the specs; FRONTEND-ARCHITECTURE §11 planned it. Add an a11y spec. **P1** |

## 7. Backend dependencies

From BACKEND-OWNER-REQUEST.md, with the backend unchanged:

1. **Critical:**
   - fix the session-validation error leak (S1);
   - set `TRUST_PROXY=1` for front proxy → Next.js → Fastify, and keep Fastify private (S2).
2. **Low:**
   - logout cookie attributes (S7);
   - optionally, clear the cookie on logout only for a valid session (S3).
3. **Deferred:** login by school code; documentation drift.

No frontend workflow is blocked by a missing backend capability. The unsupported capabilities are excluded by design.

## 8. Staging requirements (all before production)

1. **Topology:** TLS-terminating reverse proxy or load balancer → `next start` → Fastify, on a private network.
   - The proxy **writes** `X-Forwarded-For` and sets **HSTS**.
   - Fastify must not be publicly reachable.
2. **Backend settings:** `NODE_ENV=production`, a strong `COOKIE_SECRET`, `FRONTEND_URL=<frontend origin>`, `TRUST_PROXY=1`.
3. **Frontend settings:** `BACKEND_URL` set at build and run time.
4. **T5.7:** `e2e/real/ip-propagation.mjs`, adapted to the staging URLs. Distinct client IPs; a spoofed `X-Forwarded-For` rejected.
5. **T2.2 in a browser:** the cookie is `Secure`/`Strict` over HTTPS; login, refresh and logout work; there are no mixed-content errors.
6. **The full Playwright suite against the staging build** (closes F3). Include T6.4 and T6.5 under HTTPS.
7. **Backend fix S1 deployed:** re-run the reproduction (database unreachable → generic 500).

## 9. Prioritised fixes

| Priority | Item | Type | Owner |
|---|---|---|---|
| **P0** | Backend error leak (S1) | backend fix | backend owner |
| **P0** | Deployment topology + `TRUST_PROXY=1` + private backend; T5.7 on staging (S2, F1) | configuration / verification | ops + backend owner |
| **P0** | HTTPS browser cookie check (F2) and the full suite on the staging production build (F3) | verification | frontend |
| **P1** | Accessibility fixes A1–A3, and an axe spec in CI (A5) | frontend fix (no new features) | frontend |
| **P1** | Tests for untested branches: real TEACHER_BUSY (F4; seed a known busy slot in the spec's own year); generation refusal UI (F5); publish refusals (F6); archived delete (F7); editor INVARIANT_VIOLATION / ENTRY_LOCKED (F8); absence conflicts (F9). Use the real backend where it can produce the state; otherwise `page.route` on `/api/` | tests | frontend |
| **P1** | Content-Security-Policy (S4) | frontend hardening | frontend |
| **P2** | Forced-logout CSRF mitigation in `proxy.ts` (S3); skip link (A4); move `shadcn` to `devDependencies` (S5); a global scan for forbidden wording in non-interactive text (§2.3) | frontend hardening | frontend |
| **P3** | "Forget this School ID" (S6); logout cookie attributes (S7) | polish | frontend / backend |

**Housekeeping:** the disposable database holds test leftovers (QA Isolation schools from T7.4, the "QA-TT 2031-32" year with published and archived versions, and one orphaned audit session). Reset it with `e2e.sh reset --yes --seed` when approved. It was not reset in this audit.

## 10. Final recommendation

**Go for staging. No-go for production** until:
- the P0 items are done (backend S1 fix, deployment configuration with T5.7 passing, HTTPS cookie check, full suite on the production build); and
- the P1 accessibility fixes and the missing refusal-branch tests have landed.

None of these require new features or redesign. The application's functional scope, capability boundaries and authentication model are verified against the real backend.
