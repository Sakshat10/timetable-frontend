# Feature-to-API integration matrix

**Status:** proposal for review (Phase 0 gate, Decision 5.4). It supersedes `PHASE-0-AUDIT.md` §7.

**Basis:** backend `64b392390cd45af97246478a5235d754fa3b59f6`. All paths are below `/api`, called through the same-origin forwarding layer.

**Scope rules:** `CAPABILITY-BOUNDARIES.md` applies. There is no export, no workload page and no activity/audit log page; substitution history is limited to P1.

**Columns**
- **R/W:** R = read, W = write, R\* = a read that may write internally (the backend's substitution sync).
- **Gate:** the precondition the UI checks before offering the action. The backend still enforces it.
- **Handle:** the refusals the UI must turn into specific guidance. All other errors go through the generic `ApiError` handling (`FRONTEND-ARCHITECTURE.md` §5).
- **Audit:** the section of `PHASE-0-AUDIT.md` with the full request and response contract.

## M1. Authentication and onboarding: `/login`, `/signup`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Log in | `POST /admin/login {schoolId, email, password}` | W | none | 400 (field), 401 "Invalid email or password", 429 (show "try again later"; no Retry-After is sent) | §1.1, §2 |
| Current admin | `GET /admin/me` | R | none | 401 → login | §1.1 |
| School name | `GET /schools/:schoolId` | R | session | 403/404 → generic | §1.1 |
| Log out | `POST /admin/logout` (no body, no Content-Type) | W | none | none | §1.1 |
| Create school | `POST /schools {name, code, schoolType}` | W | none | 409 duplicate code; 429 (one school per 24 h per IP) | §1.1 |
| First admin | `POST /admin/register {schoolId, setupToken, name, email, password}` | W | Token held in memory from the previous step | 401 invalid or expired token (explain that the operator must issue a new one); 409 already has an admin or the email is taken; 429 | §1.1 |

- **Components:** AuthCard, PasswordField (rules: 8–100 characters, with upper, lower and digit), SchoolIdField with a copy button, SetupTokenNotice (shown once; never persisted).
- **Boundaries:** X12 (no reset link), X13 (School ID, not a code).
- **Tests:** the full auth plan (`AUTH-PROXY-TEST-PLAN.md`); mocked 401, 429 and 409.

## M2. Shell, year context and settings: layout, `/settings`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Year list and switcher | `GET /academic-years` | R | none | none | §1.2 |
| Year layout | `GET /academic-years/:id` | R | none | 403/404 → not found | §1.2 |
| Create year | `POST /academic-years {name, startDate, endDate}` | W | none | 409 duplicate name; 400 dates | §1.2 |
| Edit name and dates | `PATCH /academic-years/:id {name?, startDate?, endDate?}` | W | DRAFT or ACTIVE (COMPLETED is read-only by product rule) | 409, 400 | §1.2 |
| **Activate** | `PATCH /academic-years/:id {status:'ACTIVE'}` | W | DRAFT; **no other ACTIVE year** (UI rule); TypedConfirmDialog | 400 invalid transition | §1.2 |
| Complete | `PATCH … {status:'COMPLETED'}` | W | ACTIVE; TypedConfirmDialog | 400 | §1.2 |
| Delete year | `DELETE /academic-years/:id` | W | DRAFT | 400 not DRAFT; 409 `errors.blockedBy` | §1.2 |
| Add admin | `POST /admins {name, email, password}` | W | none | 409 duplicate email | §1.1 |
| Substitution policy | `GET/PUT /substitution-settings {consecutivePeriodPolicy}` | R/W | none | Ajv `{message}` for a bad enum | §1.17 |

- The school details are read-only, with no edit controls; the backend has no PATCH.
- **Components:** YearSwitcher, StatusBadge, ReadOnlyNotice, TypedConfirmDialog, DeleteRecordDialog.

## M3. Classes: `/y/[yearId]/classes`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Structure tree | `GET /curriculum?academicYearId=` (grades → streams → sections, with counts) | R | none | none | §1.3, §1.5 |
| Bulk create grades (+streams, +sections) | `POST /grades/bulk` | W | DRAFT | 400/409 row-keyed (`grades.N.…`); nothing written | §1.3 |
| Grade | `POST /grades`, `PATCH /grades/:id`, `DELETE /grades/:id` | W | DRAFT | 409 duplicate name or display order; 409 `blockedBy` | §1.3 |
| Stream | `POST /streams`, `PATCH /streams/:id`, `DELETE /streams/:id` | W | DRAFT | 409 duplicate code; `blockedBy` | §1.3 |
| Section | `POST /sections {gradeId, streamId?, name, code}`, `PATCH`, `DELETE` | W | DRAFT; a streamed grade needs a stream (all-or-nothing per grade) | 400 mode mismatch; `blockedBy` (including lessons in any version) | §1.3 |
| Detail reads (if needed) | `GET /grades/:gradeId/sections`, `/grades/:gradeId/streams` | R | none | none | §1.3 |

- **After any write:** invalidate `curriculum`, `feasibility` and `versions`, and warn "Existing drafts will become out of date" when drafts exist.
- **Components:** DataTable, BatchRowsDialog, DeleteRecordDialog.

## M4. Subjects: `/subjects` (school-wide)

| Action | Call | R/W | Gate | Handle |
|---|---|---|---|---|
| List | `GET /subjects` | R | none | none |
| Create, bulk | `POST /subjects`, `POST /subjects/bulk` (atomic, ≤100) | W | none | 409 duplicate code (row-keyed for bulk) |
| Edit, delete | `PATCH /subjects/:id`, `DELETE /subjects/:id` | W | none | 409 `blockedBy` (requirements, links, covers, lessons) |

Audit reference: §1.4. The code preview shows the normalisation: trimmed and upper-cased.

## M5. Curriculum: `/y/[yearId]/curriculum`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Overview | `GET /curriculum?academicYearId=` | R | none | Render `issues[]` (4 codes) | §1.5 |
| Review changes | `PUT /curriculum/grades/:gradeId {streamId?, requirements[], dryRun:true}` | R (dry run) | DRAFT | 400 row-keyed `requirements.N.*`; 409 `blockedBy` | §1.5 |
| Apply | the same body with `dryRun:false` | W | DRAFT; only after a review | the same codes; 409 concurrent create → reload | §1.5 |
| Copy from grade | `POST /curriculum/copy {fromGradeId, fromStreamId?, toGradeId, toStreamId?, dryRun}` | W | DRAFT | 400 same source and target, or empty source | §1.5 |
| Single line (optional) | `POST/PATCH/DELETE /subject-requirements[/:id]` | W | DRAFT | 409 duplicate; 409 delete while assigned; 409 when narrowing scope strands assignments | §1.5 |

- **Components:** CurriculumEditor, DiffReview (dry-run plan), IssueList.
- **Contract note:** the `PUT` and copy response shapes are not in OpenAPI. Phase 2 captures them in contract tests before the UI depends on them.

## M6. Teachers and eligibility: `/teachers`, `/teachers/[id]`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| List (with subjects) | `GET /teachers?isActive=` | R | none | none | §1.6 |
| Create, bulk | `POST /teachers`; `POST /teachers/bulk` with an **`Idempotency-Key`** header (one generated key per dialog submission, reused on an uncertain retry) | W | none | 409 duplicate code (row-keyed); a 200 `replayed:true` is treated as success; 409 key reused with a different body | §1.6 |
| Edit, deactivate, reactivate | `PATCH /teachers/:id {name?, employeeCode?, isActive?}` (only changed fields; `null` clears the code) | W | none | 409 duplicate code | §1.6 |
| Delete | `DELETE /teachers/:id` | W | none | 409 `blockedBy`, with "Deactivate instead" offered | §1.6 |
| Subject links | `GET/POST /teachers/:teacherId/subjects {subjectId, type, gradeScope?}`; `PATCH /teacher-subjects/:id {type?, gradeScope?}`; `DELETE /teacher-subjects/:id` | R/W | An inactive teacher cannot get a new link | 409 duplicate; 409 when narrowing ALL→SELECTED while assignments depend on it; 409 removal blocked | §1.7 |
| Grade eligibility (selected year) | `GET /teacher-subjects/:id/grades` (**filter to the year client-side**); `POST {gradeId}`; `DELETE …/grades/:gradeId` | R/W | **DRAFT** year for writes | 409 duplicate; 409 remove blocked by an assignment | §1.7 |

- **Model rule:** this page edits *eligibility* only. It may show (read-only) which explicit assignments the teacher has, linking to M7.
- **Components:** EligibilityMatrix (grade × subject for the selected year), GradeScopeRadio, ActiveToggle.

## M7. Assignments: `/y/[yearId]/assignments`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| List | `GET /section-subject-teachers?academicYearId=&gradeId=&sectionId=` | R | none | none | §1.8 |
| Requirements for the grid | `GET /curriculum?academicYearId=` | R | none | none | §1.5 |
| Candidate teachers | client-built from `GET /teachers` (links) + `GET /teacher-subjects/:id/grades` (this year) + `gradeScope` | R | none | (advisory only) | §1.8 |
| Pin a teacher | `POST /section-subject-teachers {sectionId, subjectRequirementId, teacherId}` | W | DRAFT | 400 inactive, not linked or not eligible (show the message); 400 section outside the scope; 409 already pinned | §1.8 |
| Change the pinned teacher | `PATCH /section-subject-teachers/:id {teacherId}` | W | DRAFT | the same 400s | §1.8 |
| Unpin (back to automatic) | `DELETE /section-subject-teachers/:id` | W | DRAFT | none | §1.8 |

**Model rule:** an unpinned cell reads "Automatic: chosen at generation". The UI never shows a teacher name for an unpinned cell.

## M8. Schedule: `/y/[yearId]/schedule`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Read | `GET /schedule-configs?academicYearId=` (0 or 1 item) | R | none | `legacy:true` → "Set break position" only | §1.9 |
| Create | `POST /schedule-configs {academicYearId, workingDays, periodsPerDay, breakAfterPeriod}` | W | DRAFT, none existing | 409 already exists → reload; 400 field errors | §1.9 |
| Update | `PATCH /schedule-configs/:id` (send only changed fields; `periodsPerDay` together with `breakAfterPeriod` when the break would fall outside) | W | DRAFT | 400 merged-state errors | §1.9 |
| Reset | `DELETE /schedule-configs/:id` | W | DRAFT | 409 `blockedBy` (versions or an active run) | §1.9 |

- **Boundary:** X14, so there are no time inputs.
- **Components:** WeekPatternEditor (day toggles, a periods stepper, a break-after selector), CapacitySummary (`weeklyTeachingCapacity`).

## M9. Readiness and generation: `/y/[yearId]/generate?run=`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Readiness | `GET /timetable-feasibility?academicYearId=` | R | none | Render every issue code with a deep link (Appendix A of the audit); `ACADEMIC_YEAR_NOT_DRAFT` → "Generation is closed for this year" | §1.10 |
| Generate | `POST /timetable-generations {academicYearId, options?{seed?, reproducible?, sourceVersionId?}}` | W | `year.status==='DRAFT' && report.status==='READY'`; a confirmation | 400 not DRAFT; 400 NOT_READY (`data.status`) → re-show readiness; 409 `existingRunId` → adopt the run; 409 `DRAFT_LIMIT_REACHED` → link to versions; 503 queue full or BUSY → retry after `Retry-After`; **uncertain → read the list, never re-POST** | §1.11, §4 |
| Regenerate keeping locks | the same with `options.sourceVersionId=<draft>` | W | Source is a DRAFT of this year | `SOURCE_VERSION_*`, `LOCKS_INVALID` (`data.issues`), `NOT_READY` (`data.issues`) | §4.5 |
| Status | `GET /timetable-generations/:id` (poll 2.5 s while QUEUED or RUNNING) | R | none | FAILED → guidance per `failure.code` (§4.3) | §4.2 |
| Recovery and history | `GET /timetable-generations?academicYearId=&limit=` | R | none | none | §1.11 |

- **Boundaries:** X1 and X2, so there is a phase stepper and elapsed time against the budget, and no cancel control.
- **On SUCCEEDED:** link to `/y/[yearId]/versions/[versionId]`, or show "draft deleted" when `versionDeleted`.

## M10. Versions: `/y/[yearId]/versions`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| List | `GET /timetable-versions?academicYearId=&includeStaleness=true` | R | none | `isStale` null → "Could not check" | §1.13 |
| Copy to new draft | `POST /timetable-versions/:id/clone {lockMode}` | W | Year DRAFT or ACTIVE | 409 `DRAFT_LIMIT_REACHED`; 409 `ACADEMIC_YEAR_NOT_EDITABLE`; 503 BUSY; **uncertain → diff the list, never re-POST** | §5.6 |
| Delete a draft | `DELETE /timetable-versions/:id` (**no body, no Content-Type**) | W | DRAFT | 409 `CONFIRMATION_REQUIRED` (it was published meanwhile) → reload | §5.7 |
| Delete an archived version | `DELETE … {confirmVersionNumber, expectedStatus:'ARCHIVED', expectedRevision}` | W | ARCHIVED; year not COMPLETED; TypedConfirmDialog | 400 `CONFIRMATION_MISMATCH`; 409 `STATUS_CHANGED`, `REVISION_CONFLICT`, `VERSION_HAS_HISTORY` (show cover counts); 503 | §5.7 |

- **Boundaries:**
  - X3/X4: no archive, restore or unpublish controls.
  - P5: the label is "Copy to new draft".
  - P6: **no delete for the PUBLISHED version** (pending review).
- **Stale drafts** get a badge and an explanation that they cannot be published and must be regenerated.

## M11. Viewer and editor: `/y/[yearId]/versions/[versionId]?view=&id=&mode=`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Version (entries, revision, counts) | `GET /timetable-versions/:id` | R | none | 403/404 → not found | §1.13 |
| Grid for a class or teacher | `GET /timetable-versions/:id/timetable?view=section\|teacher&id=` | R | none | 404 `SECTION_NOT_FOUND` / `TEACHER_NOT_FOUND` → picker | §5.1 |
| Entity pickers | `GET /curriculum` (sections), `GET /teachers` | R | none | none | none |
| Validation | `GET /timetable-versions/:id/validation` | R | none | 409 `SNAPSHOT_UNUSABLE` → "cannot be validated" | §5.4 |
| Move or swap (class view only) | `POST /timetable-versions/:id/moves {entryId, to{dayOfWeek, periodNumber}, swapWithEntryId?, expectedRevision}` | W | DRAFT version; year not COMPLETED; `mode=edit`; ≥1024 px | `SLOT_OCCUPIED` → offer a swap with `occupantEntryId`; `ENTRY_LOCKED`; `TEACHER_BUSY`; `INVALID_SLOT`, `INVALID_MOVE`, `INVALID_SWAP`; `INVARIANT_VIOLATION` (list the violations); `REVISION_CONFLICT` → reload and clear undo; `VERSION_NOT_DRAFT`; `ACADEMIC_YEAR_NOT_EDITABLE`; `SNAPSHOT_UNUSABLE`; 503 BUSY → retry | §5.2 |
| Lock or unlock | `PUT /timetable-versions/:id/locks {entryIds[≤1000], locked, expectedRevision}` | W | the same, plus allowed in the teacher view | `ENTRY_NOT_FOUND`; `REVISION_CONFLICT`; 503 | §5.3 |
| Undo/redo | inverse move, the same swap again, or the opposite lock (client stack) | W | Stack cleared on any conflict or external revision change | as above | §5.8 |
| Publish | `POST /timetable-versions/:id/publish {expectedRevision, expectedPublishedVersionId|null}` | W | `validation.informational.publishable && validation.revision === version.revision`; a confirmation naming the version that will be archived | `PUBLISHED_CHANGED` → reload and review; `STALE_CONFIGURATION` → regenerate; `VALIDATION_FAILED`; `REVISION_CONFLICT`; `VERSION_NOT_DRAFT` after an uncertain outcome → re-read (it probably succeeded); 503 | §5.5 |
| Post-publish notice | the publish response `data.substitution` | none | none | `FAILED` → link to Daily operations to retry | §5.5 (P7) |

- **Boundaries:** X5, X6, X7, X8. There is no teacher picker on lessons, no add/remove, no cross-section drop targets, no drag in the teacher view, and no export or print controls.
- **Break rendering:** derived from `grid.periods[].continuesIntoNext`.
- **Components:** TimetableGrid, LessonCell (locked and manual markers), SwapPrompt, UndoStack, ConflictBanner, ValidationPanel, PublishPanel.

## M12. Daily operations: `/operations`, `/operations/absences`, `/operations/unavailability`

| Action | Call | R/W | Gate | Handle | Audit |
|---|---|---|---|---|---|
| Daily board | `GET /substitutions?from=D&to=D&status=OPEN,ASSIGNED` (+ CANCELLED/OBSOLETE toggle; `limit` 500 + `offset`) | R\* | none | none | §1.17, §6 |
| Teacher's lessons on D (preview before recording) | `GET /timetable-versions?academicYearId=<year containing D>&status=PUBLISHED` → `GET …/timetable?view=teacher&id=` | R | A published version exists | None published → "No published timetable for this date" | §6.1 |
| Record absence | `POST /teacher-absences {…, autoAssign:true}` | W | none | 409 `ABSENCE_OVERLAP` (link to the absence); 409 `TEACHER_IS_COVERING` (list `lessons`); show `datesWithoutPublishedTimetable` and `ambiguousDates`; `automaticAllocation.status==='FAILED'` → offer retry; **uncertain → re-read the absences, never re-POST** | §1.17 |
| Absences list and detail | `GET /teacher-absences?teacherId&status&from&to`, `GET /teacher-absences/:id` | R | none | none | §1.17 |
| Absence summary | `GET /teacher-absences/:id/substitution-summary` | R | none | Attention codes (4 stored + `PAST_DATE`) | §6.2 |
| Edit absence | `PATCH /teacher-absences/:id` | W | ACTIVE absence | 409 `ASSIGNED_COVERS_OUTSIDE`, `ABSENCE_OVERLAP`, `TEACHER_IS_COVERING`, `ABSENCE_CANCELLED` | §1.17 |
| Cancel absence | `POST /teacher-absences/:id/cancel` | W | ACTIVE | 409 `ASSIGNED_COVERS_EXIST` (list them), `ABSENCE_CANCELLED` | §1.17 |
| Retry auto-assign | `POST /teacher-absences/:id/auto-assign {allowTemporaryCover?}` or `POST /substitutions/auto-assign {from, to, allowTemporaryCover?}` | W | none | Show the `run` counts | §6.2 |
| Substitute picker | `GET /substitutions/:id/candidates?includeExcluded=true` | R\* | Cover is OPEN or ASSIGNED | 409 `COVER_OBSOLETE` / `COVER_CANCELLED` → reload the board | §6.3 |
| Assign or replace | `PUT /substitutions/:id/assignment {teacherId, confirmFourConsecutive?}` | W | A tier-3 candidate needs an explicit confirmation step | `FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED` (`errors.periods`) → confirm; `FOUR_CONSECUTIVE_NOT_ALLOWED`; `ABSENT`, `UNAVAILABLE`, `TEACHING_ANOTHER_LESSON`, `ALREADY_COVERING`, `REPLACEMENT_ALREADY_BOOKED` → refresh the candidates; `IS_ABSENT_TEACHER`, `INACTIVE` | §6.3 |
| Unassign | `DELETE /substitutions/:id/assignment` | W | ASSIGNED | 409 `NOT_ASSIGNED` | §1.17 |
| Cancel cover | `POST /substitutions/:id/cancel {reason?}` | W | OPEN or ASSIGNED | 400 reserved reason | §1.17 |
| Cover detail and history | `GET /substitutions/:id` | R\* | none | none | §1.17 (P1) |
| Unavailability | `POST /teacher-unavailability {teacherId, date, periodNumber?, reason?}`; `GET /teacher-unavailability?…` (join names from `/teachers`); `DELETE /teacher-unavailability/:id` | R/W | none | 409 `UNAVAILABILITY_EXISTS`, `TEACHER_IS_COVERING`, `ALREADY_CANCELLED` | §1.17 |
| Substitution updates (bell) | `GET /substitution-events?since=<now>` then `?cursor=` every 30 s (60 s overlap, de-duplicated by id) | R | none | 400 invalid cursor → restart from `since=now` | §6.5 (P1) |

- **Dates:** UTC calendar dates (`FRONTEND-ARCHITECTURE.md` §9). The board labels the date it shows.
- **Boundaries:**
  - X9: candidate load figures appear only inside the picker (P2).
  - X10: the bell is "Substitution updates" (P1).
  - X11: no time-zone setting.
- **Components:** DatePicker (UTC), DailyBoard, AbsenceForm, AllocationNotice, CandidateList (tiers, `offered:false` group, last-resort confirmation), AutoRetryBar, CoverHistory, UpdatesBell.

## M13. Dashboard: `/dashboard`

Only facts the backend returns; no derived workload or audit metrics.

| Card | Calls |
|---|---|
| Year status and setup readiness | `GET /academic-years`, `GET /timetable-feasibility?academicYearId=` (status, error and warning counts, links) |
| Timetable | `GET /timetable-versions?academicYearId=&includeStaleness=true` (published version; latest draft and whether it is stale); `GET /timetable-generations?academicYearId=&limit=5` (recent runs) |
| Today's cover | `GET /substitutions?from=today&to=today&status=OPEN,ASSIGNED` (`total`, unfilled count from `status`/`attention`) |

Each card fails independently. The dashboard never states "all clear" when any read failed.

## Endpoint coverage check

Every operation in the audit inventory (§1, 99 operations) appears above, except:
- `GET /health`: operations only, not used by the UI.
- `GET /grades`, `GET /grades/:id`, `GET /streams/:id`, `GET /sections/:id`, `GET /subjects/:id`, `GET /teachers/:id`, `GET /subject-requirements[/:id]`, `GET /schedule-configs/:id`, `GET /section-subject-teachers/:id`: available as detail reads. The pages above use the list and curriculum reads instead. They can be adopted wherever a page needs a single record.
- `DELETE /timetable-versions/:id` for **PUBLISHED** versions: excluded pending review (P6).

No page calls an endpoint outside the inventory.
