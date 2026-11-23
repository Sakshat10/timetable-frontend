# Frontend capability boundaries (scope confirmation)

**Status: binding product boundary** (Phase 0 review, Decision 4). It applies to every phase of the rebuild.

**Basis:** the backend at `64b392390cd45af97246478a5235d754fa3b59f6`; see `PHASE-0-AUDIT.md`.

**Rule:** the UI must not contain controls, menu items, routes, empty states, copy or placeholders that imply a capability on this list. No "coming soon", disabled teaser buttons, or "contact admin to…" hints for these.

## 1. Excluded capabilities

| # | Excluded capability | Why (audit ref) | What the UI does instead | Words and controls that must not appear (interactive roles) |
|---|---|---|---|---|
| X1 | Cancelling a generation | No cancel endpoint (§1.12, §4.4) | The run continues to its end. The page can be left and resumed from the run list. | "Cancel generation", "Stop", "Abort" on a run |
| X2 | Percentage progress | The run has `phase` only (§4.2) | A phase stepper (Queued → … → Saving) plus elapsed time and the server's time budget, labelled as a budget, not an ETA | progress bars with %, "x% complete" |
| X3 | Unpublishing | No endpoint (§5.5) | Publishing another version replaces the published one. | "Unpublish", "Take offline" |
| X4 | Archiving or restoring versions | Archiving happens only inside publish; there is no restore (§5.5) | "Archived" appears only as a **status badge**. Any version can be **copied into a new draft** (clone, §5.6), described as a copy, never as a restore. | "Archive", "Restore", "Roll back", "Revert to this version" |
| X5 | Changing a lesson's teacher | Moves accept no `teacherId` (§5.2) | Teacher changes happen in setup (assignments or eligibility) followed by regeneration. The editor says lessons can be moved or swapped only. | "Change teacher", "Reassign teacher", a teacher picker on a lesson |
| X6 | Adding or removing lessons | No endpoint (§5.2) | The lesson count comes from the curriculum. | "Add lesson", "Delete lesson", "Remove lesson", empty-cell "+" |
| X7 | Moving lessons to another section | A move keeps the section; a swap needs the same section (§5.2) | Drag-and-drop exists **only in the class (section) view**. The teacher view is read-only for moves (locks are still allowed). Drop targets outside the lesson's own section grid are not rendered. | cross-section drop targets, "Move to class…" |
| X8 | Exporting timetable data | No export endpoint (§1.19) | Nothing. **No CSV, XLSX, PDF, iCal, "Download", "Export" or app-level "Print" button.** The browser's own print command is not blocked, but there is no print-specific layout or control. | "Export", "Download", "CSV", "PDF", "Print timetable" |
| X9 | Workload summaries | No workload API (§6.4) | No workload page, table, heatmap or per-teacher totals computed client-side. See §2 for backend-provided figures that may appear in context. | "Workload", "Load summary", "Teacher hours" |
| X10 | Audit or activity logs | Only cover events exist (§1.18) | No "Activity log", "Audit log" or "History" page covering setup, publishing or admin actions. See §2 (P1) for substitution history. | "Audit log", "Activity log", "Change history" (school-wide) |
| X11 | School time-zone configuration | No school time zone; "today" is UTC (§6.2) | Dates are shown as calendar dates. The daily board defaults to the backend's UTC today, and the user can pick any date. | "Time zone" settings, local-time conversions |
| X12 | Password reset (and change) | No endpoint (§2) | The login page has no reset link. | "Forgot password?", "Reset password", "Change password" |
| X13 | Login by school code | Login needs the school UUID (§2.1) | The login form asks for the **School ID**. After sign-up the ID is shown with a copy button, and the last-used ID is remembered on the device. | a "School code" login field |
| X14 | Clock times and legacy break events in the schedule | Simplified model (§1.9) | The schedule editor has working days, periods per day and one break position. A legacy configuration (`legacy:true`) is shown with the single action "Set break position". | start/end times, durations, lunch/assembly/other events |

**Model rules that are also binding:**
- **Eligibility is separate from assignment** (audit §3.1). The teacher page edits *eligibility* (subjects, grades, grade scope). The assignments page edits *optional per-section pins*. The UI never presents an auto-allocated teacher as a configured assignment, and never converts one into the other implicitly.
- **Academic-year activation** requires a prominent irreversible-action confirmation dialog:
  - It names the year.
  - It states the consequences: no regeneration; no more structure, curriculum, eligibility, assignment or schedule edits; no return to DRAFT.
  - The user must type the year's name before the confirm button enables.
  - Activation is blocked in the UI while another year is ACTIVE, because the backend does not enforce one active year (audit §9 #4).

## 2. Supported features near a boundary (please confirm at review)

These use real backend capabilities and are **in scope**, but they sit close to an excluded item. Each has a recommendation; nothing here is built until it is confirmed.

| # | Feature | Backend basis | Near | Recommendation |
|---|---|---|---|---|
| P1 | Substitution history: per-cover `history[]` and the substitution events feed (bell) | `GET /substitutions/:id`, `GET /substitution-events` (§6.5) | X10 | **Include**, labelled strictly as "Substitution updates" and "Cover history", inside Daily operations. It is never called an activity or audit log, and it never implies coverage of anything except substitutions. |
| P2 | Per-candidate `weeklyLoad`, `coverLoadToday` and `recentCovers` in the substitute picker | `GET /substitutions/:id/candidates` (§6.3) | X9 | **Include** as the backend's ranking explanation for that one cover decision. Never aggregate it into tables. |
| P3 | Teacher capacity rows in the readiness report | `GET /timetable-feasibility` → `breakdown.teachers` (§1.10) | X9 | **Include** inside readiness only, as "assigned periods versus capacity" for explicitly assigned teachers, labelled as planned demand. |
| P4 | Per-view totals (lessons, free slots, per day) in the timetable view | `GET …/timetable` → `totals` (§5.1) | X9 | **Include** as a small caption on the single grid being viewed. No cross-teacher comparison. |
| P5 | Copying an archived (or any) version into a new draft | `POST …/clone` (§5.6) | X4 | **Include** with the label "Copy to new draft". **No** "restore" wording and no clone-then-publish wizard. Publishing the copy is the normal publish flow, with its normal checks. |
| P6 | Deleting a **published** version | `DELETE …/:id` with a confirmation body (§5.7). It leaves the year with **no** published timetable, which functionally unpublishes it. | X3 | **Exclude for now.** Offer delete for DRAFT versions, and for ARCHIVED versions with typed confirmation. Remove the PUBLISHED case from the UI unless the review explicitly approves it. |
| P7 | Publish response `substitution` summary | `POST …/publish` (§5.5) | none | Include as a one-line notice after publishing ("N lessons reassigned, M need attention") linking to Daily operations. |

## 3. Superseded recommendations in `PHASE-0-AUDIT.md`

The audit is preserved as an unedited snapshot. These passages are **overridden** by this document:

| Audit location | Superseded content | Now |
|---|---|---|
| §1.19 | "Exports must be built client-side…" | X8: no export |
| §6.4 (last paragraph) | "For a workload page, compute it client-side…" | X9: no workload page |
| §7 rows "Workload", "Export"; the "Timetable viewer" row's "PrintSheet" and "print/CSV" | Workload page; export menu; print sheet | Removed (X8, X9). See `FEATURE-API-MATRIX.md`. |
| §7 row "Activity" | `/operations/activity` page | Narrowed to P1 (inside Daily operations) |
| §7 row "Versions": "Roll back = clone and publish" | Rollback workflow | P5 wording; no rollback flow |
| §5.5 last bullet | "To roll back, clone the archived version and publish the clone" | Technically true; not offered as a workflow (P5) |
| §8.1 route list `workload`; §8.3 n/a; §8.4 "read-only print/export pages" | Workload route; print pages | Removed |
| §9 rows 10 and 11 "Workaround now" | Client-side CSV and print; client-side workload | Not built |
| §11 Phase 4 "print and CSV export"; Phase 7 "workload page" | Same | Removed from the sequence (`FRONTEND-ARCHITECTURE.md` §12) |
| §2.3 "accept the school code and keep a local mapping" | Code-based login UX | X13: School ID only |

## 4. Enforcement

1. **API layer.** `lib/api/endpoints/*` exposes functions **only** for endpoints in the audit inventory. There are no stubs for non-existent endpoints, so no feature can call one.
2. **Automated boundary check (Playwright).** A `boundaries.spec.ts` visits every route in both mocked and real modes, then asserts that no element with role `button`, `link`, `menuitem`, `tab` or `option` has an accessible name matching the forbidden list in §1. The list is a case-insensitive regex with allow-listed exceptions that are supported:
   - "Cancel" inside dialogs;
   - "Cancel absence" and "Cancel cover";
   - "Archived" as a status badge (not interactive).
3. **Schedule boundary test.** The schedule form contains no time inputs (`input[type=time]`).
4. **Editor boundary test.** The teacher view has no draggable lessons. No drop target exists outside the source lesson's section.
5. **Review checklist.** Every PR touching UI answers: "Does this add any control or wording from CAPABILITY-BOUNDARIES §1?"
6. **Changing this boundary** requires a backend capability first, then an explicit decision recorded here.
