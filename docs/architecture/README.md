# Architecture documents: Timetable Maker 2.0 frontend

**Backend baseline for every document here:** `timetable-backend` @ `64b392390cd45af97246478a5235d754fa3b59f6`, inspected on 2026-11-23.

## Implementation gate (Phase 0 review, Decision 5)

| # | Gate item | Document | Status |
|---|---|---|---|
| 1 | Preserve the complete audit | [PHASE-0-AUDIT.md](PHASE-0-AUDIT.md) and [phase-0-artifacts/](phase-0-artifacts/) | Done: moved unchanged (SHA-256 verified); snapshot label and full SHA added; Appendix B path updated |
| 2 | Backend-owner request | [BACKEND-OWNER-REQUEST.md](BACKEND-OWNER-REQUEST.md) | Ready for review |
| 3 | Frontend architecture proposal | [FRONTEND-ARCHITECTURE.md](FRONTEND-ARCHITECTURE.md) | Ready for review |
| 4 | Feature-to-API integration matrix | [FEATURE-API-MATRIX.md](FEATURE-API-MATRIX.md) | Ready for review |
| 5 | Authentication and proxy test plan | [AUTH-PROXY-TEST-PLAN.md](AUTH-PROXY-TEST-PLAN.md) | Ready for review |
| 6 | Unsupported capabilities excluded | [CAPABILITY-BOUNDARIES.md](CAPABILITY-BOUNDARIES.md) | Ready for review (§2 lists 7 items to confirm) |

**Implementation has not started.** Phase 1 begins only after these are reviewed.

## Precedence

`CAPABILITY-BOUNDARIES.md` > `FEATURE-API-MATRIX.md` / `FRONTEND-ARCHITECTURE.md` > `PHASE-0-AUDIT.md`.

The audit is a snapshot and is never edited for content. Where a later decision overrides it, `CAPABILITY-BOUNDARIES.md` §3 lists the superseded passages.

## Phase 0 artefacts

| File | What it is | Notes |
|---|---|---|
| `phase-0-artifacts/openapi.json` | The backend's generated OpenAPI 3.0.3 document | First source for type generation |
| `phase-0-artifacts/routes.txt` | The Fastify route table | none |
| `phase-0-artifacts/dump.mts` | Regenerates both files | Runs against the backend checkout in memory, with no database and no listener |
| `phase-0-artifacts/probe.mts` | The error-shape, CORS and cookie probes used in the audit | none |

To run the dump script from the backend checkout:

```bash
cd ~/Desktop/timetable-backend
DATABASE_URL=postgresql://nobody@127.0.0.1:1/none ./node_modules/.bin/tsx <path>/dump.mts <output-dir>
```
