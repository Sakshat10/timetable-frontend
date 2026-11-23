# Implementation guide (conventions)

How the frontend is built. Read it before adding a page. The specifications are the other documents in this folder. The order of precedence is: `CAPABILITY-BOUNDARIES.md`, then `FEATURE-API-MATRIX.md` and `FRONTEND-ARCHITECTURE.md`, then `PHASE-0-AUDIT.md`.

## Layout

```
src/app/(auth)/…                    login, signup (public)
src/app/(app)/layout.tsx            server auth gate (GET /api/admin/me) + AppShell
src/app/(app)/years/[yearId]/…      year-scoped pages (the year lives in the URL)
src/app/(app)/operations/…          daily operations (date-based, not year-scoped)
src/app/(app)/settings, setup/start school-level pages
src/features/<module>/              components, hooks, pure rules (rules.ts + rules.test.ts)
src/components/ui/                  shadcn/ui primitives (generated; do not hand-edit beyond lint fixes)
src/components/shared/              design-system patterns (use these on every page)
src/components/data-table/          DataTable (TanStack Table v9 wrapper)
src/components/layout/              shell, sidebar, header, nav, breadcrumbs
src/lib/api/                        client, errors, endpoints, types, schemas (the only network layer)
src/lib/query/                      query client + all query keys (qk)
src/lib/dates.ts, format.ts         UTC calendar dates, labels
e2e/                                Playwright (real disposable backend + page.route overrides)
```

Route pages (`page.tsx`) stay thin. They render one feature component from `src/features/<module>`.

## Data access

- **Only** use the functions in `src/lib/api/endpoints.ts`. Never call `fetch` in a component, and never add an endpoint function for something that is not in `PHASE-0-AUDIT.md` §1.
- Use TanStack Query hooks inside `src/features/<module>/hooks.ts`, with keys from `qk` (`src/lib/query/keys.ts`). If a key is missing, ask; do not invent parallel key schemes.
- Writes are `useMutation` and pessimistic: update or invalidate after the server answers. Use the server response when it carries the new state, for example `changedEntries` from moves.
- **Uncertain writes** (`error.uncertain`: network error, timeout or 5xx): never re-send. Refetch the affected lists and tell the user to check the result. `notifyError` already words this.
- **503 with `retryAfterMs`** (`BUSY`, queue full): you may retry the same request after that delay, at most 3 times.
- **Setup changes affect drafts:** after any setup write that changes the generation input, invalidate `qk.feasibility(yearId)`, `qk.curriculum(yearId)` and `["versions", yearId]`. That covers classes, curriculum, requirements, eligibility, assignments, the schedule, and teacher activation.

## Errors

- Every error is an `ApiError` (`src/lib/api/errors.ts`) with `status`, `code`, `message`, `fieldErrors`, `details`, `retryAfterMs` and `uncertain`. Branch on `status` plus `code`.
- **Forms:** call `applyServerErrors(error, form.setError, knownFields, pathMap)`, then show any leftovers in `<FormAlert>`.
- **Dependency-checked deletes:** use `<DeleteRecordDialog>`, which renders `details.blockedBy`.
- **Toasts:** use `notifySuccess`, `notifyError` and `notifyInfo` from `src/lib/notify.ts`. Never call `toast` with raw server text from a 5xx; `ApiError` already sanitises it.
- **401** is handled globally (session ended → `/login`). Do not handle it in features.
- **403 and 404** are both "not found" (`error.isNotFound`).

## UI patterns (required)

| Need | Use |
|---|---|
| Page title, description, actions | `PageHeader` inside `PageBody` |
| Sections | `Section`, `Panel`, `FormSection` |
| Tables | `DataTable` (columns with `sortValue` for sorting) + `SearchInput`/`matchesQuery` + `Toolbar` |
| Loading | `TableSkeleton`, `CardsSkeleton`, `PageSkeleton`, `Skeleton` |
| Empty | `EmptyState` with the next action; `NoResults` for filtered lists |
| Errors | `ErrorState` (with `onRetry`); `StaleDataNotice` when a background refetch fails but data exists |
| Locked by year status | `ReadOnlyNotice` + disabled controls (`useYear().capabilities`) |
| Status | `StatusBadge`, `YearStatusBadge`, `VersionStatusBadge` (always text, never colour alone) |
| Confirmation | `ConfirmDialog` (optional `typedConfirmation`) and `DeleteRecordDialog` |
| Buttons that submit | `PendingButton` (blocks double submission) |
| Forms | react-hook-form + zod resolver + `TextField`, `NumberField`, `SelectField`, `CheckboxField`, `TextAreaField` |
| Create/edit | `Dialog` for short forms, `Sheet` (drawer) for longer ones |
| Breadcrumb label for detail pages | `useBreadcrumb(pathname, name)` |
| Numbers | `StatCard` (backend numbers only) |
| Dates | `src/lib/dates.ts` (UTC calendar dates; never `new Date(yyyyMMdd)` in local time) |

Visual rules:
- Neutral surfaces (`bg-surface`, `border`), one accent (`primary`), semantic colours only for status.
- No gradients, glass effects or decorative charts.
- The spacing scale is 2/3/4/6.
- Tables are dense, with `text-sm`.
- Every icon-only button has an `aria-label`.

## Year context

- `useYear()` returns `{ year, capabilities, basePath }`. Use `basePath` for links.
- `capabilities.canEditSetup` is true only for a DRAFT year. When it is false, disable setup writes and show `capabilities.setupLockedReason`. Do **not** hide real capabilities.
- Teacher grade-eligibility rows come back for every year: filter by `grade.academicYearId === year.id`.

## Capability boundaries

Read `CAPABILITY-BOUNDARIES.md` §1. None of those controls or words may appear. Playwright enforces this in `e2e/boundaries.spec.ts` (`FORBIDDEN_CONTROL_NAMES` in `e2e/support/boundaries.ts`). The current confirmations:
- "Copy to new draft" is approved, and is never labelled "restore".
- There is no delete for a PUBLISHED version.
- Substitution history is labelled "Substitution updates" / "Cover history".
- Candidate workload numbers appear only inside the substitute picker.

## Tests

- **Pure rules:** `src/features/<module>/*.test.ts` (Vitest, `npm test`).
- **E2E:** `e2e/<module>.spec.ts`, run against the real disposable backend on :4010 with a shared login (`storageState`).
  - Simulate refusals the backend can't produce on demand with `page.route(url => url.pathname.startsWith('/api/…'), …)`. Only ever match `/api/` paths.
  - Specs that change shared seed data must create their own records, or say they need a reseed.
- **Never** point anything at port 4000, Neon or production.
