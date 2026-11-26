# Timetable Maker 2.0: frontend architecture proposal

> **Implementation addendum (2026-11-24).** The application was built from this proposal. These are the material differences, and they take precedence over the text below:
> - **Source layout.** Code lives under `src/` (`src/app`, `src/features`, `src/components`, `src/lib`), and the year-scoped routes are **`/years/[yearId]/…`** rather than `/y/[yearId]`. The timetable pages are `/years/[yearId]/timetables` and `/timetables/[versionId]`. The guided setup is `/years/[yearId]/setup`, with `/setup/start` for a school with no academic year.
> - **Rendering model.** Next.js 16.4 ships with Cache Components available. This app does **not** enable `cacheComponents`/`partialPrefetching`, because it is fully authenticated and client-data driven. The request-time model applies, and the server layouts read the session cookie directly.
> - **Forwarding layer.** Option A (`rewrites()`) was chosen on measured evidence, together with a deployment requirement: a trusted front proxy writes `X-Forwarded-For`, and the backend sets `TRUST_PROXY=1`. See `PHASE-1-AUTH-PROXY-RESULTS.md`. Option B was rejected because a route handler cannot see the socket address when a client sends `X-Forwarded-For`.
> - **Types.** Response types are generated with `openapi-typescript --properties-required-by-default`, because none of the 671 Fastify response objects declare `required`. Conditional fields are re-marked optional in `src/lib/api/types.ts`. Request types are transcribed from the backend Zod schemas.
> - **Tables.** TanStack Table is v9 (`useTable`, `tableFeatures`), wrapped once in `src/components/data-table/data-table.tsx`.
> - **Year preference.** The last-used year is remembered in a non-sensitive `tt_year` cookie, so the server-side `/` redirect can honour it. Year data itself is never cached in the browser.
> - **Forms.** Field ids come from `useId()`, never the field name, because several forms can share a page.

- **Status:** proposal for review (Phase 0 gate, Decision 5.3). No code exists yet.
- **Inputs:**
  - `PHASE-0-AUDIT.md` (backend `64b392390cd45af97246478a5235d754fa3b59f6`)
  - `CAPABILITY-BOUNDARIES.md`
  - `AUTH-PROXY-TEST-PLAN.md`
  - `FEATURE-API-MATRIX.md`
- **Fixed constraints:**
  - Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui.
  - The backend is unchanged.
  - Session-cookie authentication only: no JWT, and no tokens in `localStorage` or `sessionStorage`.
  - The browser calls `/api/*` on the frontend origin.

## 1. Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js (App Router, current stable 16.x at scaffold time), React 19, TypeScript `strict` | Decided |
| Styling and components | Tailwind CSS (current stable), shadcn/ui (copied components, Radix primitives) | Decided. One light-only design-token set in CSS variables (`src/app/globals.css`); the OS dark preference is deliberately ignored. |
| Server state | TanStack Query v5 | Caching, polling (generation), mutations, invalidation, background-refetch-safe UI |
| Forms | react-hook-form + Zod (`@hookform/resolvers`) | What the shadcn `Form` pattern uses. The Zod rules mirror the backend's for instant feedback; the server stays authoritative. |
| Tables | `@tanstack/react-table` | Client-side sort and filter on full lists (the backend does not paginate them) |
| Drag and drop (editor only) | `@dnd-kit` | Keyboard and screen-reader accessible dragging. The editor also gets a non-drag "select lesson → choose slot" path. |
| API types | `openapi-typescript` (dev dependency) from a checked-in OpenAPI snapshot | See §6 |
| Tests | Vitest (pure rules and the error normaliser), Playwright (mocked API, plus the real disposable backend) | §11 |
| Package manager | npm | Matches the backend repository |

- **Exact versions** are pinned when the project is scaffolded (Phase 1), after checking current documentation.
- **Not added:** a state-management library (React Query plus URL state is enough), date libraries (calendar dates are plain `YYYY-MM-DD` strings; see §9), an HTTP client library (`fetch` is enough), an icon pack beyond `lucide-react`, which shadcn already uses.

## 2. Network topology and authentication

```
Browser ──same origin──> Next.js  ──/api/:path*──────────────> Fastify /api/:path*
  (cookie session_token       │  (forwarding layer; Set-Cookie passes through unchanged)
   is first-party)            │
                              └─ Server Components / proxy.ts ──fetch(BACKEND_URL, cookie forwarded)──> Fastify
```

### 2.1 The forwarding layer

Two candidates. **The choice is made by Phase 1 test results** (`AUTH-PROXY-TEST-PLAN.md`, T5 and T6), not assumed.

| | A. `rewrites()` in `next.config.ts` (default candidate) | B. Route Handler `app/api/[...path]/route.ts` (fallback) |
|---|---|---|
| Code | ~5 lines | ~80 lines: streams the body, copies headers, strips hop-by-hop headers |
| Client IP | Depends on whether Next.js appends `X-Forwarded-For`. **Unknown; must be measured.** | Explicit. We append the client address that our own trusted front proxy gave us, and drop any client-supplied value we don't trust. |
| Set-Cookie passthrough | Expected | Explicit (copy each `set-cookie` header) |
| Timeouts and limits | Next.js defaults | Controlled |
| Adopt if | T5 shows the real client IP reaches Fastify and cannot be spoofed, and T2/T6 pass | A fails any of those |

Rules that hold for either option:
- **`/api` is reserved for the backend.** The frontend defines no API routes of its own under `/api`.
- `BACKEND_URL` is a **server-only** environment variable. There is no `NEXT_PUBLIC_*` API URL, so the browser never knows the backend address.
- No caching of `/api` responses at any layer: `Cache-Control` is passed through, and nothing is put in the Next.js data cache.

### 2.2 Session lifecycle

| Step | Where | How |
|---|---|---|
| Login | Client component → `POST /api/admin/login` through the forwarding layer | The browser receives `Set-Cookie` directly. **Login is never done from a Server Action or server fetch**: that would put the Next.js IP in front of the rate limiter. |
| Sign-up | Client: `POST /api/schools` → shows the `setupToken` (kept in memory only, never persisted) → `POST /api/admin/register` → login | Matches the audit §2.1 bootstrap |
| Route guard (optimistic) | `proxy.ts` | If no `session_token` cookie is present, redirect to `/login?next=…`. No backend call (Next.js guidance). |
| Route guard (authoritative) | `app/(app)/layout.tsx` (Server Component) | `serverFetch('/api/admin/me')`. On 401, `redirect('/login?next=…')`. The admin (`id, schoolId, name, email`) is passed to a client `SessionProvider`. The school name comes from `GET /api/schools/:schoolId`. |
| A 401 during client use | the API client's global handler | Clear the query cache, then redirect once to `/login?next=<current>` with one "Your session ended" notice. Parallel 401s are deduplicated. |
| Logout | Client → `POST /api/admin/logout` | Then clear the query cache and navigate to `/login`. |
| Expiry | Backend: an absolute 7 days, with no renewal | Not extendable. Handled like any 401. |

`serverFetch` (in `lib/api/server.ts`, marked `import 'server-only'`):
- reads `session_token` from `cookies()`;
- sends **only** that cookie to `BACKEND_URL`;
- sets `cache: 'no-store'`;
- never returns the token to the client.

## 3. Directory structure

```
app/
  (public)/login/page.tsx
  (public)/signup/page.tsx
  (app)/layout.tsx                       auth gate + shell (sidebar, header, year switcher)
  (app)/dashboard/page.tsx
  (app)/subjects/page.tsx
  (app)/teachers/page.tsx
  (app)/teachers/[teacherId]/page.tsx    profile + eligibility
  (app)/operations/page.tsx              daily board (date in ?date=)
  (app)/operations/absences/page.tsx
  (app)/operations/unavailability/page.tsx
  (app)/settings/page.tsx                school (read-only), years, admins, substitution policy
  (app)/y/[yearId]/layout.tsx            year context (status → capabilities)
  (app)/y/[yearId]/classes/page.tsx
  (app)/y/[yearId]/curriculum/page.tsx
  (app)/y/[yearId]/assignments/page.tsx
  (app)/y/[yearId]/schedule/page.tsx
  (app)/y/[yearId]/generate/page.tsx     readiness + generation (?run=)
  (app)/y/[yearId]/versions/page.tsx
  (app)/y/[yearId]/versions/[versionId]/page.tsx   viewer/editor (?view=section|teacher&id=&mode=edit)
  not-found.tsx, error.tsx, global-error.tsx
proxy.ts
next.config.ts                            (rewrites if option A)
lib/
  api/client.ts      browser fetch wrapper (base '/api'), JSON, error normalisation, 401 handling
  api/server.ts      serverFetch (server-only)
  api/errors.ts      ApiError type + normalise()
  api/types.gen.ts   generated from docs/architecture/phase-0-artifacts/openapi.json (later: refreshed snapshot)
  api/schemas/       hand-written Zod for substitution + curriculum responses
  api/endpoints/     one module per backend module; typed functions only
  api/query-keys.ts
  dates.ts           UTC calendar-date helpers
features/<module>/
  components/  hooks/ (useQuery/useMutation wrappers)  rules.ts (pure, unit-tested)
components/
  ui/          shadcn/ui
  patterns/    shared product components (DataTable, BatchRowsDialog, DeleteRecordDialog,
               TypedConfirmDialog, IssueList, StatusBadge, ReadOnlyNotice, EmptyState, ErrorState)
e2e/           Playwright: mocked/, real/, boundaries.spec.ts
docs/architecture/
```

Rules:
- Components never call `fetch` directly; everything goes through `lib/api/endpoints` and hooks.
- Business decisions (DRAFT gating, publish gate, candidate grouping) live in pure `rules.ts` files.

## 4. Rendering strategy

| Area | Rendering | Why |
|---|---|---|
| Auth gate, app shell, year layout | Server Components (`serverFetch`) | One authoritative session check per navigation; the year status is known before the page renders |
| Feature pages | Client Components with TanStack Query | Every module is interactive (mutations, polling, drag-and-drop, dialogs). One data path avoids duplicated server and client fetching. |
| Server prefetch with hydration | Not initially | Can be added per page later (versions list, viewer) if measurements justify it |
| Static marketing or help content | None planned | none |

Every page has a route-level `loading.tsx` (a skeleton matching the layout) and an `error.tsx`. The error page shows generic copy only and never the server message.

## 5. API client and error normalisation

```ts
type ApiError = {
  status: number;                         // 0 = network error / timeout / aborted
  code: string | null;                    // data.code ?? errors.code?.[0] ?? null
  message: string;                        // safe text; any 5xx → fixed generic text
  fieldErrors: Record<string, string[]>;  // Zod `errors` minus `code`; Ajv `{message}` → { _form: [message] }
  details: Record<string, unknown>;       // `data` minus code (e.g. existingRunId, occupantEntryId, revision)
                                          // or `errors` extras (blockedBy, periods, coverRequestIds, lessons)
  retryAfterMs: number | null;            // from Retry-After
  uncertain: boolean;                     // write + (network error | 5xx | timeout): outcome unknown
};
```

The four backend error dialects (audit §1.0) are recognised by shape, not by route:

| Shape | Example |
|---|---|
| Zod | `{success:false, message:'Validation failed', errors}` |
| Ajv | `{message}` with no `success`, before auth |
| Coded (versions, generation) | `{success:false, message, data:{code,…}}` |
| Coded (substitution) | `{success:false, message, errors:{code:[…],…}}` |

Plus 429, P2002 or P2003 conflicts without a code, and 5xx.

Client rules:
- **No automatic retry of writes**, except 503 with `Retry-After` (BUSY, queue full): retry the same request at most 3 times with a visible "Retrying…".
- **Uncertain outcome of a write:** never re-send. Re-read the affected resource and reconcile. This matters for generation, clone, absence, publish and bulk create. Bulk teachers is the only write we can safely repeat, because it has an `Idempotency-Key`.
- **Requests without a body** send no `Content-Type` (DELETE of a draft version, logout, and similar).
- **Field paths** such as `grades.0.sections.1.code` or `requirements.3.periodsPerWeek` are mapped onto form rows by `features/*/rules.ts`.
- **Messages:** backend 4xx `message` text is shown as plain text, never as HTML. 5xx bodies are never shown.

## 6. Types and contract safety

1. **Generated types.** `lib/api/types.gen.ts` is generated with `openapi-typescript` from a **checked-in** OpenAPI snapshot.
   - The first snapshot is `docs/architecture/phase-0-artifacts/openapi.json` (backend `64b3923`).
   - To refresh it, re-run `phase-0-artifacts/dump.mts` against the backend checkout. It runs in memory, needs no database and touches nothing. Commit the snapshot together with the backend SHA.
2. **Response types** are used from OpenAPI for every module that declares response schemas. Fastify strips undeclared fields, so these schemas are accurate.
3. **Request types** for the Zod-validated modules (versions, generation, feasibility, schedule, requirements, assignments) are hand-written from the backend Zod source. Their OpenAPI request schemas are documentation only, and they differ in places (for example, the `dayOfWeek` enum).
4. **Substitution and curriculum** have no response schemas. They get hand-written Zod schemas in `lib/api/schemas/`, built from the services and the live captures (`timetable-backend/e2e/dashboard/API_CONTRACTS.md`).
   - These schemas are parsed in development and test.
   - In production, a parse failure is reported and the raw data is still used, to avoid breaking the UI on an additive change.
5. **Contract tests** (`e2e/real/contracts.spec.ts`) run against the disposable backend (`e2e.sh`, port 4010) through the forwarding layer. They assert each response shape the UI parses and each of the four error dialects.

## 7. Data fetching, caching and invalidation

- **Query keys** follow audit §8.4, minus the workload and export keys.
- **Defaults:** `staleTime` 30 s for setup lists and 0 for operational data (covers, candidates, runs). `refetchOnWindowFocus` is on. Retries apply to GET only (2, with backoff, never for 4xx).
- **Polling:**
  - generation run: 2.5 s while QUEUED or RUNNING, paused when the tab is hidden;
  - substitution events: 30 s with a 60 s overlap window, de-duplicated by id;
  - editor revision check: `GET /timetable-versions/:id` every 20 s while editing, and on focus.
  - **Nothing else is polled.** The staleness-heavy reads (versions with `includeStaleness`, feasibility, validation) refresh on focus and after writes only.
- **Invalidation matrix:**

| After | Invalidate or update |
|---|---|
| Any year-scoped setup write | the entity list, `curriculum`, `feasibility`, `versions` (drafts may now be stale) |
| Subject or teacher writes | `subjects` / `teachers`, `feasibility` |
| Run reaches SUCCEEDED | `runs`, `versions` |
| Move | Apply `changedEntries`, `revision` and `metrics` to `version` and the visible `view`s; invalidate `validation` |
| Lock | Update `revision` and `lockedCount`; refetch the visible views (the backend returns counts only); invalidate `validation` |
| Publish | `versions`, `version`, `validation`, `covers`, `substitutionEvents` |
| Clone or delete a version | `versions` |
| Substitution writes | `covers`, `cover`, `absence` + summary, `candidates`, `substitutionEvents` |

- **Background refetch failure while data is shown:** keep the data and show a non-blocking "Couldn't refresh" notice.
- **Writes are pessimistic.** The editor applies the server's `changedEntries`; it does not guess.

## 8. Academic-year context

- **The year lives in the URL:** `/y/[yearId]/…`. The last year used is remembered per device (in `localStorage`, wrapped in try/catch) only to choose the default.
- **Default year:** the ACTIVE year if one exists, otherwise the newest DRAFT, otherwise "Create your first academic year".
- **Capabilities** are computed once in the year layout from `status` and exposed by a hook:
  - `canEditSetup = DRAFT` (structure, curriculum, eligibility rows, assignments, schedule);
  - `canGenerate = DRAFT`;
  - `canEditVersions = DRAFT || ACTIVE`;
  - `canPublish = DRAFT || ACTIVE`;
  - COMPLETED is read-only everywhere.
- **Disabled controls explain why** ("This year is active. Setup is locked."). They are not hidden, because they are real capabilities that the year's state prevents. This differs from the boundary items, which never appear at all.
- **School-wide data:** subjects and teachers. Teacher grade-eligibility rows are filtered to the selected year (the backend returns every year).
- **Activation:** a `TypedConfirmDialog` per `CAPABILITY-BOUNDARIES.md`. It is blocked while another year is ACTIVE.

## 9. Dates

- **Operational dates** (absences, covers, unavailability) are `YYYY-MM-DD` UTC calendar dates.
  - `lib/dates.ts` provides parse, format and add-days on the strings, plus `todayUtc()`.
  - Weekday names are formatted with `Intl.DateTimeFormat(…, { timeZone: 'UTC' })`.
  - The browser time zone is never applied to a calendar date.
- **The daily board** shows the date it is displaying ("Showing Tue 24 Nov"). It defaults to `todayUtc()` and offers a date picker. There is no time-zone setting (X11).
- **Timestamps** (`createdAt`, `publishedAt`, run times) are shown in the user's locale as relative or absolute times. They are instants, not calendar dates.

## 10. UI system, accessibility and responsiveness

- **Visual language:** shadcn/ui with one restrained token set (neutral surfaces, one accent, semantic success/warning/destructive). No gradients or glass effects; minimal shadows.
- **Status is never colour-only:** DRAFT, ACTIVE, COMPLETED, PUBLISHED, ARCHIVED, stale, locked and manual all carry text or an icon with an accessible label.
- **Shared patterns:**
  - `DataTable` (sort, filter, empty and error states);
  - `BatchRowsDialog` (multi-row create with row-keyed errors);
  - `DeleteRecordDialog` (renders `errors.blockedBy`);
  - `TypedConfirmDialog` (activation, deleting an archived version);
  - `IssueList` (feasibility issues with deep links);
  - `TimetableGrid` (days × periods, with a break separator derived from `continuesIntoNext`).
- **Keyboard:**
  - every flow is completable without a mouse;
  - the editor has keyboard move and swap (select a lesson, choose a slot, confirm);
  - focus returns to the trigger after dialogs;
  - visible focus rings.
- **Responsive:**
  - Desktop gets the full editor.
  - On tablets the timetable grid scrolls horizontally inside its own container, never the page.
  - On mobile, the views are read-only, with a day-by-day list for the grid.
  - Editing is offered at ≥ 1024 px; smaller screens show "Editing needs a larger screen" instead of a broken drag-and-drop.
- **Reduced motion** is honoured, and touch targets are ≥ 44 px on touch layouts.

## 11. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Pure rules | Vitest | Error normaliser (all dialects), DRAFT/capability rules, publish gate, candidate grouping, UTC dates, field-path mapping |
| Mocked UI | Playwright with `page.route` (route predicate matches `/api/` only) | Every page's loading, empty and error states; every refusal code the UI handles; boundary checks |
| Real backend | Playwright + Node checks against `timetable-backend/e2e/dashboard/e2e.sh` (port 4010, disposable local database `timetable_dashboard_e2e_test`) | Contracts, auth/proxy plan, golden paths per module |
| Boundaries | `e2e/boundaries.spec.ts` | `CAPABILITY-BOUNDARIES.md` §4 |
| Accessibility | `@axe-core/playwright` on each page (dev dependency) | No serious or critical violations |

The real suite never touches port 4000, `.env`, Neon or any non-disposable database.

## 12. Implementation sequence (revised for the boundaries)

| Phase | Scope | Exit gate |
|---|---|---|
| 1. Foundation | Scaffold; forwarding layer (option A or B decided by tests); API client and normaliser; type generation; `proxy.ts` + server gate; login, sign-up, logout; shell; year context; test harnesses; boundary spec skeleton | **All of `AUTH-PROXY-TEST-PLAN.md` passes or is recorded with an accepted finding.** The TRUST_PROXY recommendation is sent to the backend owner. |
| 2. School setup | Years (including the activation confirmation), classes (with bulk), subjects (bulk), teachers (bulk, deactivate), eligibility, curriculum (dry-run review), assignments, schedule (simplified), record deletion | Real-backend golden paths; DRAFT gating; row-keyed errors |
| 3. Readiness and generation | Feasibility with deep links; generation (phase stepper, polling, recovery, failure guidance, regenerate keeping locks) | Lost-response, 409-adopt and restart recovery tested |
| 4. Versions and viewer | Versions list with staleness; section and teacher viewer; copy to new draft; delete (draft, or archived with typed confirmation); validation panel; publish with the substitution notice | Grid matches the stored entries; publish refusals covered |
| 5. Editor | Section-view move and swap (drag and keyboard); locks; client undo/redo; revision-conflict handling; metrics delta | Every move/lock refusal code exercised against the real backend |
| 6. Daily operations | Daily board, absences, unavailability, substitute picker (tiers, last-resort confirmation), auto-assign retry, cancel; substitution policy; "Substitution updates" (P1) | UTC-date handling; obsolete-after-republish flow |
| 7. Dashboard | Only backend-provided facts: published version, latest draft and staleness, readiness, recent runs, today's covers | Partial-failure states; no invented metrics |
| 8. Hardening | Accessibility, responsive pass, performance, security review, full mocked and real suites in CI | Green |

## 13. Security checklist (frontend)

- The session token is never readable by JS: the cookie is HttpOnly and never copied anywhere.
- `BACKEND_URL` is server-only, and `server-only` guards `serverFetch`.
- No `dangerouslySetInnerHTML`. Backend text is rendered as text.
- 5xx bodies are never displayed (they can leak internals; see `BACKEND-OWNER-REQUEST.md` §2).
- Security headers are set in `next.config.ts`:
  - `Content-Security-Policy` (self only; no inline scripts beyond what Next.js requires, using a nonce if needed);
  - `X-Content-Type-Options`;
  - `Referrer-Policy`;
  - `frame-ancestors 'none'`.
- CSRF relies on `SameSite` (Strict in production) plus JSON-only writes. The frontend adds no state-changing GET routes. Test T6.4 verifies a cross-site POST carries no session.
- The setup token is kept in component memory only and cleared after registration.
- Logging: no session tokens, passwords or setup tokens in client logs or error reports.

## Addendum: UI redesign and public landing page (2026-11-24)

- **Routing.** `/` is public (`src/app/page.tsx`). With a session cookie it calls `GET /api/admin/me` server-side. A valid session redirects to the remembered, ACTIVE or newest DRAFT year's dashboard (or to `/setup/start` when there is none). With no cookie, or a stale one, the landing page is shown (`src/features/landing/`). `src/proxy.ts` treats `/` as public, and every other route keeps its session redirect.
- **Theme.** Light only. `next-themes`, the `.dark` tokens and the Appearance menu were removed. The `dark` variant is pinned to a class that is never applied, so a `dark:` utility can never follow the OS preference. `e2e/landing.spec.ts` checks that pages stay light under `prefers-color-scheme: dark`.
- **Design system.**
  - **Tokens** (`globals.css`): canvas `--background`, white `--surface`, `--surface-subtle`, blue `--primary`/`--primary-hover`/`--primary-soft`, `--border`/`--border-strong`, and the shadow scale `shadow-xs` / `shadow-card` / `shadow-raised` / `shadow-overlay`.
  - **Primitives:** heights are 36px by default and 32px for `sm`. Dialogs use `rounded-2xl` with `shadow-overlay`.
  - **Shared components:** `PageHeader`, `Panel`, `StatCard`, the state components and `DataTable` carry the card styling. The brand mark is `src/components/brand/logo.tsx`.
- **Landing copy** describes only implemented capabilities. It has no metrics, testimonials, logos, prices or contact details, and the hero preview is an illustration labelled as sample data.
