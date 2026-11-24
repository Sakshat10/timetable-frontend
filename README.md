# Timetable Maker: frontend

The web application for the School Timetable Maker. School administrators use it to:
- set up an academic year: classes, subjects, curriculum, teachers and their eligibility, optional teacher assignments, and the weekly schedule;
- check readiness and generate timetables with the backend's constraint solver;
- review, adjust and publish timetables;
- run daily cover for absent teachers.

It is a client of the existing **Fastify backend** (`timetable-backend`, a separate repository). The backend is the source of truth. This repository contains no business rules of its own and no database.

## Technology

| Area | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript (strict) |
| UI | Tailwind CSS v4, shadcn/ui (Radix), Lucide icons, Sonner notifications, Recharts (one data chart) |
| Data | TanStack Query v5, TanStack Table v9 (wrapped in `src/components/data-table`) |
| Forms | React Hook Form + Zod |
| Editor | @dnd-kit (drag and drop for supported lesson moves and swaps) |
| API types | Generated from the audited OpenAPI snapshot (`openapi-typescript`) |
| Tests | Vitest, Playwright (against the real disposable backend), axe-core |

## Prerequisites

- **Node.js 24** and npm.
- **For local development:** a running backend (see `timetable-backend/README.md`). That means PostgreSQL, the API on `http://127.0.0.1:4000`, and, for generation, the Python solver environment.
- **For end-to-end tests:** the backend's disposable environment. `timetable-backend/e2e/dashboard/e2e.sh` runs a seeded local database and an API on `http://127.0.0.1:4010`.

## Install and configure

```bash
npm install
cp .env.example .env.local      # never commit .env.local
```

| Variable | Required | Meaning |
|---|---|---|
| `BACKEND_URL` | yes | The backend **origin**, without `/api`, for example `http://127.0.0.1:4000`. Server-only: the browser never sees it. It is read at **build time** for the `/api` rewrite and at runtime by server components, so set it before `npm run build`. |

`BACKEND_URL` is validated at start-up (`src/lib/server-env.ts`). A missing or malformed value stops the server with a clear message.

## Run

```bash
npm run dev          # http://localhost:3000   (backend: BACKEND_URL from .env.local)
npm run build        # production build
npm start            # serve the production build on :3000
```

The backend allows only one browser origin (`FRONTEND_URL`, default `http://localhost:3000`). Because the browser calls `/api/*` on the frontend's own origin and Next.js forwards it, cross-origin requests never happen in normal use.

**Ports:**

| Port | Use |
|---|---|
| 3000 | Frontend development server |
| 3100 | Playwright test server (separate build directory `.next-e2e`) |
| 4000 | Backend for development |
| 4010 | Disposable e2e backend |
| 3200 / 4011 | Used only by the client-IP measurement script |

## Test

```bash
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
npm test                       # Vitest: pure rules, error normaliser, API boundary
npm run verify                 # all three

# End-to-end (real backend). Prepare the disposable backend first:
../timetable-backend/e2e/dashboard/e2e.sh status             # must report the identity check and :4010 listening
../timetable-backend/e2e/dashboard/e2e.sh restart            # resets the in-memory login limiter (5 logins / 15 min)
npm run e2e:auth               # authentication and proxy (AUTH-PROXY-TEST-PLAN T1, T2, T4, T7)
npm run e2e:app                # every module + capability boundaries
npm run e2e:mobile             # phone-width layout checks
npm run e2e                    # everything
npm run e2e:ip                 # T5 client-IP propagation measurement (starts its own :4011 backend and :3100 Next)
```

- E2E tests start (or reuse) a Next.js server on :3100 pointed at :4010.
- They refuse to run against port 4000, and never use the backend `.env`, Neon or production data.
- Tests that need direct SQL (session expiry) touch only `timetable_dashboard_e2e_test`, after an identity check.
- Some specs generate, edit and publish timetables in their **own** test academic years. After a full run, reseed the disposable database with `e2e.sh reset --yes --seed`.

## Architecture

```
Browser ──same origin──> Next.js ──/api/* (rewrites)──> Fastify backend
                          │  server components forward only the session cookie (src/lib/api/server.ts)
```

- **Authentication.** The backend's HttpOnly session cookie (`session_token`) is used as is: no JWT, and no tokens in browser storage.
  - `src/proxy.ts` redirects requests without a cookie to `/login`.
  - The signed-in layout checks `GET /api/admin/me` on the server.
  - Any 401 during use clears cached data and returns the user to login once.
- **API layer.** `src/lib/api/endpoints.ts` has one typed function per audited backend operation, and none for capabilities the backend lacks.
- **Errors.** `src/lib/api/errors.ts` normalises the backend's four error formats into one `ApiError`. Server errors are never shown verbatim.
- **Year context.** The academic year lives in the URL (`/years/[yearId]/…`). Its status decides what can be edited:
  - **Draft:** setup and generation.
  - **Active:** timetable drafts and publishing only.
  - **Completed:** read-only.
- **Dates.** Operational dates are UTC calendar dates, as the backend defines "today" (`src/lib/dates.ts`). There is no school time-zone setting.

Specifications and decisions are in [`docs/architecture/`](docs/architecture/README.md):
- the Phase 0 backend audit;
- the architecture;
- the feature-to-API matrix;
- capability boundaries;
- the auth and proxy test plan and its results;
- the backend-owner request;
- the implementation guide.

## Deployment

1. **Topology:** a trusted reverse proxy or load balancer → Next.js (`npm start`) → Fastify. The front proxy must **write** `X-Forwarded-For`, by appending or overwriting.
2. **Exposure:** Next.js must not be exposed to the internet without that proxy, and Fastify must be reachable **only** from Next.js.
3. **Backend settings:** `NODE_ENV=production`, a strong `COOKIE_SECRET`, `FRONTEND_URL=<frontend origin>`, and **`TRUST_PROXY=1`** for the topology above. Re-measure with a CDN in front (see `docs/architecture/PHASE-1-AUTH-PROXY-RESULTS.md`).
4. **Frontend settings:** `BACKEND_URL=<internal backend origin>` at build and run time.
5. **HTTPS is required.** In production the session cookie is `Secure; SameSite=Strict`, and it is first-party because the browser only talks to the frontend origin.

**Release checks not automated here:**
- staging client-IP measurement (T5.7);
- `Secure`/`Strict` cookie flags in a browser over HTTPS (T2.2);
- cross-site form checks (T6.4, T6.5).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The dev server exits with "Invalid frontend environment" | `BACKEND_URL` is missing or includes `/api`. Fix `.env.local`. |
| "Can’t reach the timetable service" after sign-in | The backend at `BACKEND_URL` is down. Check `GET <BACKEND_URL>/health`. |
| Login returns "Too many sign-in attempts" | The backend limits logins to 5 per 15 minutes per address. Restart the disposable backend (`e2e.sh restart`), or wait. |
| Every user hits the login limit together in production | The backend's `TRUST_PROXY` is not set for the proxy chain (see Deployment). |
| Generation stays "Queued" | The backend's generation runner is disabled (`GENERATION_RUNNER_ENABLED=false`) or the solver environment is missing. |
| Playwright hangs or a "test" takes many minutes | The machine slept, or Desktop iCloud sync is busy. Run under `caffeinate -i`, and/or copy the repository outside the synced Desktop. |
| Pages show "Not found" for a year | The year belongs to another school or was deleted. Open `/` to go to your default year. |
