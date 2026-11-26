import { expect, request, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { seed } from "./support/seed";

/**
 * Refusal handling of the timetable module: editor, generation, publish and archived deletion.
 *
 * "[real]"  : the real backend (:4010 via the Next forwarding layer) produces the refusal.
 * "[mocked]": the refusal is simulated with page.route on an /api/ path only.
 *
 * DATA OWNERSHIP: everything happens in this spec's own academic year "QA-TR 2033-34" (2033-04-01..2034-03-31) with
 * its own "QA-TR" grades and teachers and the seeded subjects. The QA-TR Mathematics teacher is pinned to BOTH sections,
 * so a real TEACHER_BUSY is deterministic. The seeded ACTIVE year is only read (plus one refused POST that changes nothing).
 * Drafts are deleted after the run; published/archived versions (and archived versions with cover history, which the
 * backend never deletes) stay in this year. The one absence recorded is cancelled in the same test.
 */

const YEAR_NAME = "QA-TR 2033-34";
const SUBJECTS = ["Mathematics", "English", "Science", "Hindi"] as const;
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;
const SCHEDULE = { workingDays: [...DAYS], periodsPerDay: 6, breakAfterPeriod: 3 };
/** The week of Monday 2033-04-04 (inside the year): the absence date is the first weekday the pinned teacher teaches. */
const WEEK: Record<string, string> = { MONDAY: "2033-04-04", TUESDAY: "2033-04-05", WEDNESDAY: "2033-04-06", THURSDAY: "2033-04-07", FRIDAY: "2033-04-08" };
const SHORT: Record<string, string> = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri" };

type Day = (typeof DAYS)[number];
interface Entry {
  id: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  dayOfWeek: Day;
  periodNumber: number;
  isLocked: boolean;
}
interface Version {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  revision: number;
  entries: Entry[];
}

let api: APIRequestContext;
let yearId = "";
let scheduleId = "";
let sections: string[] = []; // [S1, S2]
let mathsTeacherId = "";
let draftA = ""; // generated draft used by the editor and publish tests

// ------------------------------------------------------------------ API helpers

async function raw(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const response = await api.fetch(path, { method, ...(body !== undefined ? { data: body } : {}) });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as { data?: unknown; message?: string }) : {};
  return { status: response.status(), json, data: json.data as Record<string, unknown> | null | undefined };
}

async function call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, ok: number[] = []): Promise<T> {
  const r = await raw(method, path, body);
  if (r.status >= 400 && !ok.includes(r.status)) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.data as T;
}

const getVersion = (id: string) => call<Version>("GET", `/api/timetable-versions/${id}`);
const listVersions = () => call<Version[]>("GET", `/api/timetable-versions?academicYearId=${yearId}`);

async function waitForRun(runId: string) {
  for (let i = 0; i < 150; i++) {
    const run = await call<{ status: string; versionId: string | null; failure: unknown }>("GET", `/api/timetable-generations/${runId}`);
    if (run.status === "SUCCEEDED") return run.versionId as string;
    if (run.status === "FAILED") throw new Error(`generation failed: ${JSON.stringify(run.failure)}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("generation did not finish in time");
}

async function generate(): Promise<string> {
  const r = await raw("POST", "/api/timetable-generations", { academicYearId: yearId });
  if (r.status === 409 && typeof r.data?.existingRunId === "string") {
    await waitForRun(r.data.existingRunId);
    return generate();
  }
  if (r.status !== 202) throw new Error(`generation start → ${r.status} ${JSON.stringify(r.json)}`);
  return waitForRun(r.data!.generationRunId as string);
}

const cloneOf = async (id: string) => (await call<{ id: string }>("POST", `/api/timetable-versions/${id}/clone`, { lockMode: "NONE" })).id;

async function publishApi(id: string) {
  const v = await getVersion(id);
  const published = (await listVersions()).find((x) => x.status === "PUBLISHED")?.id ?? null;
  return call<{ substitution: unknown }>("POST", `/api/timetable-versions/${id}/publish`, { expectedRevision: v.revision, expectedPublishedVersionId: published });
}

const move = async (id: string, body: Record<string, unknown>) => raw("POST", `/api/timetable-versions/${id}/moves`, body);

function freeSlots(entries: Entry[], sectionId: string) {
  const used = new Set(entries.filter((e) => e.sectionId === sectionId).map((e) => `${e.dayOfWeek}|${e.periodNumber}`));
  return DAYS.flatMap((day) => [1, 2, 3, 4, 5, 6].filter((p) => !used.has(`${day}|${p}`)).map((periodNumber) => ({ dayOfWeek: day, periodNumber })));
}

/** Performs one real, accepted move inside a section (tries candidates until the backend accepts). */
async function legalMove(versionId: string, sectionId: string, skip: (e: Entry) => boolean = () => false) {
  const v = await getVersion(versionId);
  for (const entry of v.entries.filter((e) => e.sectionId === sectionId && !e.isLocked && !skip(e))) {
    for (const to of freeSlots(v.entries, sectionId)) {
      const current = await getVersion(versionId);
      const r = await move(versionId, { entryId: entry.id, to, expectedRevision: current.revision });
      if (r.status === 200) return { entry, to };
    }
  }
  throw new Error("no legal move found");
}

// ------------------------------------------------------------------ UI helpers

const lessonCard = (page: Page, entryId: string) => page.locator(`[data-testid="lesson"][data-entry-id="${entryId}"]`);
const dropCell = (page: Page, day: string, period: number) => page.locator(`[data-testid="drop-cell"][data-slot="${day}|${period}"]`);

async function openEditor(page: Page, versionId: string, sectionId: string) {
  await page.goto(`/years/${yearId}/timetables/${versionId}?view=section&id=${sectionId}&mode=edit`);
  await expect(page.getByTestId("drop-cell")).toHaveCount(30);
}

/** Keyboard/no-drag path: select → choose an empty slot → confirm. */
async function uiMoveToEmpty(page: Page, entryId: string, day: string, period: number) {
  await lessonCard(page, entryId).getByRole("button", { name: /^Select / }).click();
  await page.getByRole("button", { name: `Move here: ${SHORT[day]} P${period}` }).click();
  await page.getByRole("button", { name: "Confirm move" }).click();
}

const editorNotice = (page: Page) => page.getByTestId("editor-notice");

async function openPublishDialog(page: Page, versionId: string) {
  const v = await getVersion(versionId);
  await page.goto(`/years/${yearId}/timetables/${versionId}`);
  const button = page.getByRole("button", { name: `Publish version ${v.versionNumber}` });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
  return { dialog: page.getByRole("alertdialog"), version: v };
}

function refusal(route: Route, status: number, data: Record<string, unknown> | null, message = "Refused", headers: Record<string, string> = {}) {
  return route.fulfill({ status, headers, json: data ? { success: false, message, data } : { success: false, message } });
}

const isPost = (route: Route) => route.request().method() === "POST";

async function gotoGenerateReady(page: Page) {
  await page.goto(`/years/${yearId}/generate`);
  const button = page.getByRole("button", { name: "Generate timetable" });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  return button;
}

async function openDeleteDialog(page: Page, versionNumber: number) {
  await page.goto(`/years/${yearId}/timetables`);
  await page.getByRole("button", { name: `More actions for version ${versionNumber}` }).click();
  await page.getByRole("menuitem", { name: "Delete version" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox").fill(String(versionNumber));
  return dialog;
}

// ------------------------------------------------------------------ setup

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(240_000);
  api = await request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" });

  const years = await call<Array<{ id: string; name: string; startDate: string; endDate: string }>>("GET", "/api/academic-years");
  const mine = years.find((y) => y.name === YEAR_NAME);
  if (mine) yearId = mine.id;
  else {
    const overlaps = years.filter((y) => y.startDate.slice(0, 10) <= "2034-03-31" && y.endDate.slice(0, 10) >= "2033-04-01");
    if (overlaps.length) throw new Error(`another year overlaps 2033-34: ${overlaps.map((y) => y.name).join(", ")}`);
    yearId = (await call<{ id: string }>("POST", "/api/academic-years", { name: YEAR_NAME, startDate: "2033-04-01", endDate: "2034-03-31" })).id;
  }

  let grades = await call<Array<{ id: string; name: string }>>("GET", `/api/grades?academicYearId=${yearId}`);
  if (grades.length === 0) {
    await call("POST", "/api/grades/bulk", {
      academicYearId: yearId,
      grades: [
        { name: "QA-TR Grade 1", displayOrder: 1, sections: [{ name: "A", code: "A" }] },
        { name: "QA-TR Grade 2", displayOrder: 2, sections: [{ name: "A", code: "A" }] },
      ],
    });
    grades = await call("GET", `/api/grades?academicYearId=${yearId}`);
  }
  grades.sort((a, b) => a.name.localeCompare(b.name));
  sections = [];
  for (const g of grades) sections.push(...(await call<Array<{ id: string }>>("GET", `/api/grades/${g.id}/sections`)).map((s) => s.id));

  const subjects = await call<Array<{ id: string; name: string }>>("GET", "/api/subjects");
  const subjectId = (name: string) => {
    const s = subjects.find((x) => x.name === name);
    if (!s) throw new Error(`seeded subject ${name} missing`);
    return s.id;
  };
  let teachers = await call<Array<{ id: string; name: string }>>("GET", "/api/teachers");
  for (const name of SUBJECTS) {
    const teacherName = `QA-TR ${name} Teacher`;
    let teacher = teachers.find((t) => t.name === teacherName);
    if (!teacher) {
      teacher = await call<{ id: string; name: string }>("POST", "/api/teachers", { name: teacherName });
      teachers = [...teachers, teacher];
    }
    if (name === "Mathematics") mathsTeacherId = teacher.id;
    const links = await call<Array<{ id: string; subjectId?: string; subject?: { id: string } }>>("GET", `/api/teachers/${teacher.id}/subjects`);
    let link = links.find((l) => (l.subjectId ?? l.subject?.id) === subjectId(name));
    link ??= await call<{ id: string }>("POST", `/api/teachers/${teacher.id}/subjects`, { subjectId: subjectId(name), type: "PRIMARY", gradeScope: "SELECTED_GRADES" });
    for (const g of grades) await call("POST", `/api/teacher-subjects/${link.id}/grades`, { gradeId: g.id }, [409]);
  }

  for (const g of grades) {
    await call("PUT", `/api/curriculum/grades/${g.id}`, { streamId: null, requirements: SUBJECTS.map((n) => ({ subjectId: subjectId(n), periodsPerWeek: 6 })) });
  }

  // Pin the SAME Mathematics teacher in both sections (deterministic TEACHER_BUSY).
  const requirements = await call<Array<{ id: string; gradeId: string; subjectId: string }>>("GET", `/api/subject-requirements?academicYearId=${yearId}`);
  const pins = await call<Array<{ sectionId: string; subjectRequirementId: string }>>("GET", `/api/section-subject-teachers?academicYearId=${yearId}`);
  for (const [i, g] of grades.entries()) {
    const req = requirements.find((r) => r.gradeId === g.id && r.subjectId === subjectId("Mathematics"));
    if (!req) throw new Error("maths requirement missing");
    if (!pins.some((p) => p.sectionId === sections[i] && p.subjectRequirementId === req.id)) {
      await call("POST", "/api/section-subject-teachers", { sectionId: sections[i], subjectRequirementId: req.id, teacherId: mathsTeacherId });
    }
  }

  const schedules = await call<Array<{ id: string }>>("GET", `/api/schedule-configs?academicYearId=${yearId}`);
  scheduleId = schedules[0]?.id ?? (await call<{ id: string }>("POST", "/api/schedule-configs", { academicYearId: yearId, ...SCHEDULE })).id;
  await call("PATCH", `/api/schedule-configs/${scheduleId}`, SCHEDULE); // undo a stale-test change left by an interrupted run

  for (const v of (await listVersions()).filter((x) => x.status === "DRAFT")) await call("DELETE", `/api/timetable-versions/${v.id}`);
  const feasibility = await call<{ status: string }>("GET", `/api/timetable-feasibility?academicYearId=${yearId}`);
  expect(feasibility.status).toBe("READY");
  draftA = await generate();
});

test.afterAll(async () => {
  if (api) {
    if (scheduleId) await call("PATCH", `/api/schedule-configs/${scheduleId}`, SCHEDULE).catch(() => undefined);
    for (const v of (await listVersions().catch(() => [])).filter((x) => x.status === "DRAFT")) {
      await raw("DELETE", `/api/timetable-versions/${v.id}`).catch(() => undefined);
    }
    await api.dispose();
  }
});

// ------------------------------------------------------------------ 1. editor refusals

test("[real] TEACHER_BUSY: a UI move into a slot where the teacher teaches the other section is refused", async ({ page }) => {
  const [s1, s2] = sections;
  let v = await getVersion(draftA);
  const t = mathsTeacherId;
  const tLessonS1 = v.entries.find((e) => e.sectionId === s1 && e.teacherId === t && !e.isLocked);
  expect(tLessonS1, "the pinned teacher teaches S1").toBeTruthy();

  const s1At = (e: Entry[], day: string, p: number) => e.find((x) => x.sectionId === s1 && x.dayOfWeek === day && x.periodNumber === p);
  let target = v.entries.filter((e) => e.sectionId === s2 && e.teacherId === t).find((e) => !s1At(v.entries, e.dayOfWeek, e.periodNumber));
  if (!target) {
    // Create one: empty one of S1's slots in which T teaches S2, with a real accepted move.
    outer: for (const busySlot of v.entries.filter((e) => e.sectionId === s2 && e.teacherId === t)) {
      const occupant = s1At(v.entries, busySlot.dayOfWeek, busySlot.periodNumber)!;
      for (const to of freeSlots(v.entries, s1)) {
        const r = await move(draftA, { entryId: occupant.id, to, expectedRevision: (await getVersion(draftA)).revision });
        if (r.status === 200) {
          target = busySlot;
          break outer;
        }
      }
    }
    v = await getVersion(draftA);
  }
  expect(target, "a slot exists (or was created) where T teaches S2 and S1 is free").toBeTruthy();
  const before = v.revision;

  await openEditor(page, draftA, s1);
  const response = page.waitForResponse((r) => r.url().includes(`/api/timetable-versions/${draftA}/moves`) && r.request().method() === "POST");
  await uiMoveToEmpty(page, tLessonS1!.id, target!.dayOfWeek, target!.periodNumber);
  const answer = await response;
  expect(answer.status()).toBe(409);
  expect((await answer.json()).data.code).toBe("TEACHER_BUSY");
  await expect(editorNotice(page)).toContainText("The teacher is busy then");
  await expect(dropCell(page, tLessonS1!.dayOfWeek, tLessonS1!.periodNumber).locator(`[data-entry-id="${tLessonS1!.id}"]`)).toBeVisible();
  expect((await getVersion(draftA)).revision).toBe(before);
});

test("[real] ENTRY_LOCKED: the API refuses a locked lesson, the UI blocks dragging/selecting it and reports a refused swap", async ({ page }) => {
  const s1 = sections[0];
  let v = await getVersion(draftA);
  const mine = v.entries.filter((e) => e.sectionId === s1 && !e.isLocked);
  const locked = mine[0];
  const other = mine.find((e) => e.id !== locked.id && e.subjectId !== locked.subjectId)!;
  await call("PUT", `/api/timetable-versions/${draftA}/locks`, { entryIds: [locked.id], locked: true, expectedRevision: v.revision });
  try {
    v = await getVersion(draftA);
    const r = await move(draftA, { entryId: locked.id, to: freeSlots(v.entries, s1)[0], expectedRevision: v.revision });
    expect(r.status).toBe(409);
    expect(r.data?.code).toBe("ENTRY_LOCKED");

    await openEditor(page, draftA, s1);
    const card = lessonCard(page, locked.id);
    await expect(card.getByRole("button", { name: /^Unlock / })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("button", { name: /^Select / })).toHaveCount(0); // not selectable
    await expect(card.locator("[aria-roledescription='draggable lesson']")).toHaveCount(0); // not draggable

    // A swap onto the locked lesson is offered (hints are advisory) and refused by the server.
    await lessonCard(page, other.id).getByRole("button", { name: /^Select / }).click();
    await dropCell(page, locked.dayOfWeek, locked.periodNumber).getByRole("button", { name: "Swap here" }).click();
    const response = page.waitForResponse((res) => res.url().includes("/moves") && res.request().method() === "POST");
    await page.getByRole("button", { name: "Confirm swap" }).click();
    expect((await (await response).json()).data.code).toBe("ENTRY_LOCKED");
    await expect(editorNotice(page)).toContainText(/A locked lesson can.t be moved/);
    expect((await getVersion(draftA)).revision).toBe(v.revision);
  } finally {
    const now = await getVersion(draftA);
    await call("PUT", `/api/timetable-versions/${draftA}/locks`, { entryIds: [locked.id], locked: false, expectedRevision: now.revision });
  }
});

test("[real] API contract: INVALID_SLOT, INVALID_MOVE, INVALID_SWAP and REVISION_CONFLICT on moves", async () => {
  const v = await getVersion(draftA);
  const e = v.entries.find((x) => !x.isLocked)!;
  const own = { dayOfWeek: e.dayOfWeek, periodNumber: e.periodNumber };

  const slot = await move(draftA, { entryId: e.id, to: { dayOfWeek: "SATURDAY", periodNumber: 1 }, expectedRevision: v.revision });
  expect([slot.status, slot.data?.code]).toEqual([400, "INVALID_SLOT"]);

  const same = await move(draftA, { entryId: e.id, to: own, expectedRevision: v.revision });
  expect([same.status, same.data?.code]).toEqual([400, "INVALID_MOVE"]);

  const self = await move(draftA, { entryId: e.id, to: own, swapWithEntryId: e.id, expectedRevision: v.revision });
  expect([self.status, self.data?.code]).toEqual([400, "INVALID_SWAP"]);

  const stale = await move(draftA, { entryId: e.id, to: freeSlots(v.entries, e.sectionId)[0], expectedRevision: v.revision + 7 });
  expect([stale.status, stale.data?.code]).toEqual([409, "REVISION_CONFLICT"]);

  expect((await getVersion(draftA)).revision).toBe(v.revision);
});

test("[mocked] editor messages for INVARIANT_VIOLATION (with violations) and SNAPSHOT_UNUSABLE", async ({ page }) => {
  const s1 = sections[0];
  const v = await getVersion(draftA);
  const lesson = v.entries.find((e) => e.sectionId === s1 && !e.isLocked)!;
  const free = freeSlots(v.entries, s1)[0];
  const movesUrl = (url: URL) => url.pathname === `/api/timetable-versions/${draftA}/moves`;

  await openEditor(page, draftA, s1);
  await page.route(movesUrl, (route) =>
    refusal(route, 409, {
      code: "INVARIANT_VIOLATION",
      violations: [
        { code: "PERIOD_COUNT", message: "Mathematics would have 5 periods instead of 6" },
        { code: "TEACHER_CAPACITY", message: "A teacher would exceed 32 periods" },
      ],
    }),
    { times: 1 },
  );
  await uiMoveToEmpty(page, lesson.id, free.dayOfWeek, free.periodNumber);
  await expect(editorNotice(page)).toContainText("The change would break a scheduling rule");
  await expect(editorNotice(page).getByRole("listitem")).toHaveText(["Mathematics would have 5 periods instead of 6", "A teacher would exceed 32 periods"]);
  await page.getByRole("button", { name: "Dismiss message" }).click();

  await page.route(movesUrl, (route) => refusal(route, 409, { code: "SNAPSHOT_UNUSABLE" }), { times: 1 });
  await uiMoveToEmpty(page, lesson.id, free.dayOfWeek, free.periodNumber);
  await expect(editorNotice(page)).toContainText(/This draft can.t be edited/);
  await expect(editorNotice(page)).toContainText("The setup snapshot stored with it");
  await expect(dropCell(page, lesson.dayOfWeek, lesson.periodNumber).locator(`[data-entry-id="${lesson.id}"]`)).toBeVisible();
  expect((await getVersion(draftA)).revision).toBe(v.revision);
});

// ------------------------------------------------------------------ 2. generation refusals

test("[real] 409 existingRunId: clicking Generate while a run is active adopts that run", async ({ page }) => {
  test.setTimeout(180_000);
  const button = await gotoGenerateReady(page);
  await button.click();
  const started = await raw("POST", "/api/timetable-generations", { academicYearId: yearId });
  expect(started.status).toBe(202);
  const runId = started.data!.generationRunId as string;
  const response = page.waitForResponse((r) => r.url().endsWith("/api/timetable-generations") && r.request().method() === "POST");
  await page.getByRole("alertdialog").getByRole("button", { name: "Generate", exact: true }).click();
  const answer = await response;
  expect(answer.status()).toBe(409);
  expect((await answer.json()).data.existingRunId).toBe(runId);
  await expect(page).toHaveURL(new RegExp(`[?&]run=${runId}`));
  await expect(page.getByRole("list", { name: "Generation phases" })).toBeVisible();
  await waitForRun(runId);
});

test("[real] 400 not DRAFT: the API refuses generation for the seeded ACTIVE year and the UI shows generation closed", async ({ page }) => {
  const activeId = seed().academicYears.current.id;
  const r = await raw("POST", "/api/timetable-generations", { academicYearId: activeId });
  expect(r.status).toBe(400);
  expect(r.json.message).toMatch(/DRAFT/);
  await page.goto(`/years/${activeId}/generate`);
  await expect(page.getByText("Generation is closed for this year")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate timetable" })).toHaveCount(0);
});

const generationsPost = (url: URL) => url.pathname === "/api/timetable-generations";

async function startFromUi(page: Page) {
  await (await gotoGenerateReady(page)).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Generate", exact: true }).click();
}

test("[mocked] DRAFT_LIMIT_REACHED links to the timetables page", async ({ page }) => {
  await page.route(generationsPost, (route) => (isPost(route) ? refusal(route, 409, { code: "DRAFT_LIMIT_REACHED", drafts: 20, maxDraftsPerYear: 20 }) : route.fallback()));
  await startFromUi(page);
  const alert = page.getByRole("alert").filter({ hasText: "limit of draft timetables" });
  await expect(alert).toContainText("at most 20 drafts");
  await expect(alert.getByRole("link", { name: "Manage drafts" })).toHaveAttribute("href", `/years/${yearId}/timetables`);
});

test("[mocked] 503 queue full honours Retry-After with a countdown", async ({ page }) => {
  await page.route(generationsPost, (route) =>
    isPost(route) ? refusal(route, 503, null, "The timetable generation queue is full. Please try again shortly", { "Retry-After": "30" }) : route.fallback(),
  );
  await startFromUi(page);
  await expect(page.getByRole("alert").filter({ hasText: "The generation queue is full" })).toContainText("try again in 30 seconds");
  await expect(page.getByText(/You can try again in \d+ s\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate timetable" })).toBeDisabled();
});

test("[mocked] LOCKS_INVALID lists details.issues", async ({ page }) => {
  await page.route(generationsPost, (route) =>
    isPost(route)
      ? refusal(route, 400, {
          code: "LOCKS_INVALID",
          issueCount: 2,
          issues: [
            { code: "LOCK_SLOT_NOT_IN_GRID", message: "A locked Mathematics lesson is on a day that is no longer a working day" },
            { code: "LOCK_TEACHER_CHANGED", message: "A locked English lesson's teacher is no longer assigned" },
          ],
        })
      : route.fallback(),
  );
  await startFromUi(page);
  const alert = page.getByRole("alert").filter({ hasText: "locked lessons of the source draft" });
  await expect(alert.getByRole("listitem")).toHaveText([
    "A locked Mathematics lesson is on a day that is no longer a working day",
    "A locked English lesson's teacher is no longer assigned",
  ]);
});

test("[mocked] uncertain start (aborted POST) is never re-sent and the newest run from the list is adopted", async ({ page }) => {
  const fakeId = "00000000-0000-4000-8000-00000000abcd";
  let posts = 0;
  let aborted = false;
  const now = new Date().toISOString();
  const fakeRun = {
    id: fakeId,
    academicYearId: yearId,
    status: "RUNNING",
    phase: "SOLVING",
    attempts: 1,
    seed: null,
    reproducible: null,
    timeLimitSeconds: 10,
    workers: 1,
    sectionCount: 2,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    versionId: null,
    sourceVersionId: null,
    lockedEntryCount: 0,
    versionDeleted: false,
    result: null,
    failure: null,
  };
  await page.route(generationsPost, async (route) => {
    if (isPost(route)) {
      posts += 1;
      aborted = true;
      return route.abort("failed");
    }
    if (!aborted) return route.fallback();
    const real = await route.fetch();
    const body = (await real.json()) as { data: unknown[] };
    return route.fulfill({ json: { ...body, data: [fakeRun, ...body.data] } });
  });
  await page.route((url) => url.pathname === `/api/timetable-generations/${fakeId}`, (route) => route.fulfill({ json: { success: true, message: "ok", data: fakeRun } }));

  await startFromUi(page);
  await expect(page).toHaveURL(new RegExp(`[?&]run=${fakeId}`));
  await expect(page.getByRole("list", { name: "Generation phases" })).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(posts).toBe(1);
});

test("[mocked] NOT_READY from POST refreshes readiness and explains", async ({ page }) => {
  await page.route(generationsPost, (route) =>
    isPost(route) ? refusal(route, 400, { status: "NOT_READY", summary: {}, errorCount: 1, errors: [], warnings: [] }, "The academic year is not ready for timetable generation") : route.fallback(),
  );
  await gotoGenerateReady(page);
  const recheck = page.waitForRequest((r) => r.url().includes("/api/timetable-feasibility") && r.method() === "GET");
  await page.getByRole("button", { name: "Generate timetable" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "The year is not ready for generation" })).toContainText("readiness report has been refreshed");
  await recheck;
});

// ------------------------------------------------------------------ 3. publish refusals

test("[real] PUBLISHED_CHANGED: another version is published while A is open", async ({ page }) => {
  const draftB = await cloneOf(draftA);
  const { dialog } = await openPublishDialog(page, draftA);
  await publishApi(draftB);
  const response = page.waitForResponse((r) => r.url().includes(`/api/timetable-versions/${draftA}/publish`));
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  expect((await (await response).json()).data.code).toBe("PUBLISHED_CHANGED");
  await expect(dialog.getByRole("alert")).toContainText("Another version was published meanwhile");
  expect((await getVersion(draftA)).status).toBe("DRAFT");
});

test("[real] REVISION_CONFLICT on publish: A changes through the API before the editor notices", async ({ page }) => {
  const { dialog, version } = await openPublishDialog(page, draftA);
  await legalMove(draftA, sections[0]);
  const response = page.waitForResponse((r) => r.url().includes(`/api/timetable-versions/${draftA}/publish`));
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  const answer = await response;
  expect(answer.request().postDataJSON().expectedRevision).toBe(version.revision);
  expect((await answer.json()).data.code).toBe("REVISION_CONFLICT");
  await expect(dialog.getByRole("alert")).toContainText("This draft was changed meanwhile");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText(`Revision ${version.revision + 1}`)).toBeVisible(); // reloaded
  expect((await getVersion(draftA)).status).toBe("DRAFT");
});

const publishUrl = (id: string) => (url: URL) => url.pathname === `/api/timetable-versions/${id}/publish`;

test("[mocked] STALE_CONFIGURATION on publish", async ({ page }) => {
  await page.route(publishUrl(draftA), (route) => refusal(route, 409, { code: "STALE_CONFIGURATION", reason: "CONFIGURATION_CHANGED" }));
  const { dialog } = await openPublishDialog(page, draftA);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("The setup has changed since this draft was generated");
});

test("[mocked] VALIDATION_FAILED on publish lists the violations", async ({ page }) => {
  await page.route(publishUrl(draftA), (route) =>
    refusal(route, 409, { code: "VALIDATION_FAILED", violationCount: 1, violations: [{ code: "TEACHER_COLLISION", message: "A teacher is in two classes on Monday P2" }] }),
  );
  const { dialog } = await openPublishDialog(page, draftA);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("scheduling rule violations");
  await expect(dialog.getByRole("alert").getByRole("listitem")).toHaveText(["A teacher is in two classes on Monday P2"]);
});

test("[mocked] uncertain publish (answer lost after the server published) is re-read and treated as success", async ({ page }) => {
  const draft = await cloneOf(draftA);
  let posts = 0;
  await page.route(publishUrl(draft), async (route) => {
    posts += 1;
    await route.fetch(); // the real publish happens…
    await route.abort("failed"); // …but its answer is lost
  });
  const { dialog, version } = await openPublishDialog(page, draft);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(`Version ${version.versionNumber} is published`)).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(posts).toBe(1);
  expect((await getVersion(draft)).status).toBe("PUBLISHED");
});

test("[mocked] VERSION_NOT_DRAFT after an uncertain outcome is treated as success when the version is now published", async ({ page }) => {
  const draft = await cloneOf(draftA);
  await page.route(publishUrl(draft), async (route) => {
    await route.fetch(); // published by an earlier attempt whose answer was lost
    await refusal(route, 409, { code: "VERSION_NOT_DRAFT", status: "PUBLISHED" });
  });
  const { dialog, version } = await openPublishDialog(page, draft);
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText(`Version ${version.versionNumber} is published`)).toBeVisible();
  await expect(dialog).toBeHidden();
  expect((await getVersion(draft)).status).toBe("PUBLISHED");
});

// ------------------------------------------------------------------ 4. archived deletion

test("[real] delete an ARCHIVED version through the UI with typed confirmation", async ({ page }) => {
  const v1 = await cloneOf(draftA);
  const v2 = await cloneOf(draftA);
  await publishApi(v1);
  await publishApi(v2);
  const archived = await getVersion(v1);
  expect(archived.status).toBe("ARCHIVED");

  const dialog = await openDeleteDialog(page, archived.versionNumber);
  const del = page.waitForRequest((r) => r.url().endsWith(`/api/timetable-versions/${v1}`) && r.method() === "DELETE");
  await dialog.getByRole("button", { name: `Delete version ${archived.versionNumber}` }).click();
  expect((await del).postDataJSON()).toEqual({ confirmVersionNumber: archived.versionNumber, expectedStatus: "ARCHIVED", expectedRevision: archived.revision });
  await expect(page.getByText(`Version ${archived.versionNumber} deleted`)).toBeVisible();
  await expect(page.getByRole("link", { name: `Version ${archived.versionNumber}`, exact: true })).toHaveCount(0);
  expect((await raw("GET", `/api/timetable-versions/${v1}`)).status).toBe(404);
});

test("[real] API contract: VERSION_NOT_DRAFT when moving a lesson of the published version", async () => {
  const published = (await listVersions()).find((v) => v.status === "PUBLISHED")!;
  const v = await getVersion(published.id);
  const e = v.entries[0];
  const r = await move(v.id, { entryId: e.id, to: freeSlots(v.entries, e.sectionId)[0], expectedRevision: v.revision });
  expect([r.status, r.data?.code]).toEqual([409, "VERSION_NOT_DRAFT"]);
});

test("[real] VERSION_HAS_HISTORY: an archived version with cover requests can't be deleted; cover counts are shown", async ({ page }) => {
  const withHistory = (await listVersions()).find((v) => v.status === "PUBLISHED")!;
  const teachingDay = (await getVersion(withHistory.id)).entries.find((e) => e.teacherId === mathsTeacherId)!.dayOfWeek;
  const absenceDate = WEEK[teachingDay];
  const created = await call<{ absence: { id: string }; coverRequestsCreated: number }>("POST", "/api/teacher-absences", {
    teacherId: mathsTeacherId,
    startDate: absenceDate,
    endDate: absenceDate,
    autoAssign: false,
    reason: "QA-TR refusal test",
  });
  try {
    expect(created.coverRequestsCreated).toBeGreaterThan(0);
    await publishApi(await cloneOf(withHistory.id)); // withHistory becomes ARCHIVED
    const archived = await getVersion(withHistory.id);
    expect(archived.status).toBe("ARCHIVED");

    const dialog = await openDeleteDialog(page, archived.versionNumber);
    const response = page.waitForResponse((r) => r.url().endsWith(`/api/timetable-versions/${archived.id}`) && r.request().method() === "DELETE");
    await dialog.getByRole("button", { name: `Delete version ${archived.versionNumber}` }).click();
    const body = await (await response).json();
    expect(body.data.code).toBe("VERSION_HAS_HISTORY");
    const total = body.data.coverRequestTotal as number;
    await expect(dialog.getByRole("alert")).toContainText("substitute cover was arranged from it");
    await expect(dialog.getByRole("alert")).toContainText(`${total} cover request${total === 1 ? "" : "s"}`);
    expect((await getVersion(archived.id)).status).toBe("ARCHIVED");
  } finally {
    await call("POST", `/api/teacher-absences/${created.absence.id}/cancel`);
  }
});

test("[mocked] CONFIRMATION_MISMATCH and STATUS_CHANGED on archived deletion", async ({ page }) => {
  const archived = (await listVersions()).find((v) => v.status === "ARCHIVED")!;
  const deleteUrl = (url: URL) => url.pathname === `/api/timetable-versions/${archived.id}`;
  let deletes = 0;
  const codes = ["CONFIRMATION_MISMATCH", "STATUS_CHANGED"];
  await page.route(deleteUrl, (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const code = codes[deletes++] ?? "STATUS_CHANGED";
    return refusal(route, code === "CONFIRMATION_MISMATCH" ? 400 : 409, { code });
  });

  const dialog = await openDeleteDialog(page, archived.versionNumber);
  const confirm = dialog.getByRole("button", { name: `Delete version ${archived.versionNumber}` });
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText(`The number typed does not match. Type ${archived.versionNumber} to confirm.`);
  const refreshed = page.waitForRequest((r) => r.url().includes(`/api/timetable-versions?academicYearId=${yearId}`));
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText("status changed meanwhile");
  await refreshed; // the list is reloaded after STATUS_CHANGED
  expect(deletes).toBe(2);
  expect((await getVersion(archived.id)).status).toBe("ARCHIVED");
});

// ------------------------------------------------------------------ 3b. stale draft (last: it edits the schedule, restored in finally)

test("[real] a draft becomes out of date after a schedule change: badge shown and publish disabled", async ({ page }) => {
  const stale = await cloneOf(draftA);
  const staleNumber = (await getVersion(stale)).versionNumber;
  await call("PATCH", `/api/schedule-configs/${scheduleId}`, { periodsPerDay: 7 });
  try {
    const listed = (await call<Array<{ id: string; isStale: boolean | null }>>("GET", `/api/timetable-versions?academicYearId=${yearId}&includeStaleness=true`)).find((v) => v.id === stale);
    expect(listed?.isStale).toBe(true);

    await page.goto(`/years/${yearId}/timetables`);
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: `Version ${staleNumber}`, exact: true }) });
    await expect(row.getByText("Out of date")).toBeVisible();
    await expect(page.getByText(/out of date: the setup changed after/)).toBeVisible();

    await page.goto(`/years/${yearId}/timetables/${stale}`);
    await expect(page.getByRole("button", { name: `Publish version ${staleNumber}` })).toBeDisabled();
    await expect(page.getByText(/The setup has changed since this draft was generated, so it can.t be published/)).toBeVisible();
  } finally {
    await call("PATCH", `/api/schedule-configs/${scheduleId}`, SCHEDULE);
  }
});
