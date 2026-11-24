import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { forbiddenControls } from "./support/boundaries";

/**
 * Readiness, generation, viewer, editor, versions and publishing against the REAL backend.
 *
 * DATA OWNERSHIP: this spec creates and uses its own academic year "QA-TT 2031-32" (2031-04-01..2032-03-31) with
 * two grades of one section each, its own teachers ("QA-TT …") and the seeded subjects. It publishes ONLY in that
 * year. The seeded ACTIVE year 2026-27 is checked read-only. The year is left in place (setup is idempotent).
 */

const YEAR_NAME = "QA-TT 2031-32";
const ACTIVE_YEAR_ID = "f19dcf01-f5e9-4c82-a6e9-6dc898af7240";
const SUBJECTS = ["Mathematics", "English", "Science", "Hindi"] as const;
const PERIODS_PER_SUBJECT = 6; // 24 of 30 weekly slots per class: leaves free cells for moves

type Day = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";
interface Entry {
  id: string;
  sectionId: string;
  subjectId: string;
  teacherId: string;
  dayOfWeek: Day;
  periodNumber: number;
  isLocked: boolean;
  source: string;
}

let api: APIRequestContext;
let yearId = "";
let sectionIds: string[] = [];
let mathsTeacherId = "";
let versionId = "";
let versionNumber = 0;

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
  const response = await api.fetch(path, { method, ...(body !== undefined ? { data: body } : {}) });
  if (!response.ok() && !okStatuses.includes(response.status())) {
    throw new Error(`${method} ${path} → ${response.status()} ${await response.text()}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text).data : null) as T;
}

const DAYS: Day[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
const slotKey = (day: string, period: number) => `${day}|${period}`;

async function entries(): Promise<Entry[]> {
  return (await call<{ entries: Entry[] }>("GET", `/api/timetable-versions/${versionId}`)).entries;
}

function busy(all: Entry[], teacherId: string, day: string, period: number, ignore: string[]) {
  return all.some((e) => !ignore.includes(e.id) && e.teacherId === teacherId && e.dayOfWeek === day && e.periodNumber === period);
}

function freeSlots(all: Entry[], sectionId: string) {
  const used = new Set(all.filter((e) => e.sectionId === sectionId).map((e) => slotKey(e.dayOfWeek, e.periodNumber)));
  const out: Array<{ day: Day; period: number }> = [];
  for (const day of DAYS) for (let period = 1; period <= 6; period++) if (!used.has(slotKey(day, period))) out.push({ day, period });
  return out;
}

const cell = (page: Page, day: string, period: number) => page.locator(`[data-testid="drop-cell"][data-slot="${slotKey(day, period)}"]`);
const lesson = (page: Page, entryId: string) => page.locator(`[data-testid="lesson"][data-entry-id="${entryId}"]`);

async function dragTo(page: Page, entryId: string, day: string, period: number) {
  await page.getByTestId("timetable-grid").scrollIntoViewIfNeeded();
  await page.getByTestId("timetable-grid").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const from = await lesson(page, entryId).boundingBox();
  const to = await cell(page, day, period).boundingBox();
  if (!from || !to) throw new Error("drag target not visible");
  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ baseURL }) => {
  api = await request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" });

  // --- the year
  const years = await call<Array<{ id: string; name: string; status: string }>>("GET", "/api/academic-years");
  const existing = years.find((y) => y.name === YEAR_NAME);
  yearId = existing?.id ?? (await call<{ id: string }>("POST", "/api/academic-years", { name: YEAR_NAME, startDate: "2031-04-01", endDate: "2032-03-31" })).id;

  // --- two grades with one section each
  let grades = await call<Array<{ id: string; name: string }>>("GET", `/api/grades?academicYearId=${yearId}`);
  if (grades.length === 0) {
    await call("POST", "/api/grades/bulk", {
      academicYearId: yearId,
      grades: [
        { name: "QA-TT Grade 1", displayOrder: 1, sections: [{ name: "A", code: "A" }] },
        { name: "QA-TT Grade 2", displayOrder: 2, sections: [{ name: "A", code: "A" }] },
      ],
    });
    grades = await call("GET", `/api/grades?academicYearId=${yearId}`);
  }
  grades.sort((a, b) => a.name.localeCompare(b.name));
  sectionIds = [];
  for (const g of grades) sectionIds.push(...(await call<Array<{ id: string }>>("GET", `/api/grades/${g.id}/sections`)).map((s) => s.id));

  // --- teachers (own records) eligible for this year's grades only
  const subjects = await call<Array<{ id: string; name: string }>>("GET", "/api/subjects");
  let teachers = await call<Array<{ id: string; name: string }>>("GET", "/api/teachers");
  for (const name of SUBJECTS) {
    const subject = subjects.find((s) => s.name === name);
    if (!subject) throw new Error(`seeded subject ${name} missing`);
    const teacherName = `QA-TT ${name} Teacher`;
    let teacher = teachers.find((t) => t.name === teacherName);
    if (!teacher) {
      teacher = await call<{ id: string; name: string }>("POST", "/api/teachers", { name: teacherName });
      teachers = [...teachers, teacher];
    }
    if (name === "Mathematics") mathsTeacherId = teacher.id;
    const links = await call<Array<{ id: string; subjectId?: string; subject?: { id: string } }>>("GET", `/api/teachers/${teacher.id}/subjects`);
    let link = links.find((l) => (l.subjectId ?? l.subject?.id) === subject.id);
    link ??= await call<{ id: string }>("POST", `/api/teachers/${teacher.id}/subjects`, { subjectId: subject.id, type: "PRIMARY", gradeScope: "SELECTED_GRADES" });
    for (const g of grades) await call("POST", `/api/teacher-subjects/${link.id}/grades`, { gradeId: g.id }, [409]);
  }

  // --- curriculum and schedule
  for (const g of grades) {
    await call("PUT", `/api/curriculum/grades/${g.id}`, {
      streamId: null,
      requirements: SUBJECTS.map((name) => ({ subjectId: subjects.find((s) => s.name === name)!.id, periodsPerWeek: PERIODS_PER_SUBJECT })),
    });
  }
  const schedules = await call<unknown[]>("GET", `/api/schedule-configs?academicYearId=${yearId}`);
  if (schedules.length === 0) {
    await call("POST", "/api/schedule-configs", { academicYearId: yearId, workingDays: DAYS, periodsPerDay: 6, breakAfterPeriod: 3 });
  }

  // --- leftover drafts from earlier runs of this spec (this year only): no body for drafts
  const versions = await call<Array<{ id: string; status: string }>>("GET", `/api/timetable-versions?academicYearId=${yearId}`);
  for (const v of versions.filter((v) => v.status === "DRAFT")) await call("DELETE", `/api/timetable-versions/${v.id}`);
});

test.afterAll(async () => {
  await api?.dispose();
});

test("readiness is READY and a real generation creates a draft", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/years/${yearId}/generate`);
  await expect(page.getByText("READY means the pre-generation checks passed; it does not guarantee the solver will find a timetable.")).toBeVisible();
  await expect(page.locator("section[aria-labelledby='readiness-title']").getByText("Ready", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Generate timetable" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page).toHaveURL(/[?&]run=[0-9a-f-]{36}/);
  await expect(page.getByRole("list", { name: "Generation phases" })).toBeVisible();
  expect(await page.getByRole("progressbar").count()).toBe(0); // X2
  expect(await forbiddenControls(page)).toEqual([]); // X1 (no cancel/stop)

  const open = page.getByRole("link", { name: "Open the new draft" });
  await expect(open).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/Draft version \d+ was created/)).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/\/timetables\/[0-9a-f-]{36}/);
  versionId = page.url().match(/timetables\/([0-9a-f-]{36})/)![1];
  versionNumber = (await call<{ versionNumber: number }>("GET", `/api/timetable-versions/${versionId}`)).versionNumber;
  await expect(page.getByRole("heading", { name: `Version ${versionNumber}` })).toBeVisible();
});

test("class and teacher grids render with the break and no drag in the teacher view", async ({ page }) => {
  await page.goto(`/years/${yearId}/timetables/${versionId}?view=section&id=${sectionIds[0]}`);
  const grid = page.getByTestId("timetable-grid");
  await expect(grid).toBeVisible();
  await expect(grid.getByTestId("break-row")).toHaveCount(1);
  await expect(grid.getByTestId("lesson")).toHaveCount(SUBJECTS.length * PERIODS_PER_SUBJECT);
  await expect(page.getByTestId("totals")).toContainText(`${SUBJECTS.length * PERIODS_PER_SUBJECT} lessons · 6 free slots`);

  await page.goto(`/years/${yearId}/timetables/${versionId}?view=teacher&id=${mathsTeacherId}&mode=edit`);
  await expect(page.getByTestId("timetable-grid")).toBeVisible();
  await expect(page.getByTestId("timetable-grid").getByText(/^QA-TT Grade [12] · A$/).first()).toBeVisible();
  // X7: the teacher view has no drop targets and no draggable lessons (locks only).
  await expect(page.getByTestId("drop-cell")).toHaveCount(0);
  await expect(page.locator("[aria-roledescription='draggable lesson']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Lock Mathematics/ }).first()).toBeVisible();
  expect(await forbiddenControls(page)).toEqual([]);
});

test("move (drag), swap (keyboard path), undo, lock and unlock", async ({ page }) => {
  const section = sectionIds[0];
  await page.goto(`/years/${yearId}/timetables/${versionId}?view=section&id=${section}&mode=edit`);
  await expect(page.getByTestId("drop-cell")).toHaveCount(30);

  // MOVE by drag: a lesson to a free slot where its teacher is free.
  let all = await entries();
  const mine = all.filter((e) => e.sectionId === section && !e.isLocked);
  const free = freeSlots(all, section);
  const move = mine.flatMap((e) => free.filter((s) => !busy(all, e.teacherId, s.day, s.period, [e.id])).map((s) => ({ e, s })))[0];
  expect(move, "a legal move exists").toBeTruthy();
  const moveResponse = page.waitForResponse((r) => r.url().includes(`/api/timetable-versions/${versionId}/moves`) && r.request().method() === "POST");
  await dragTo(page, move.e.id, move.s.day, move.s.period);
  expect((await moveResponse).status()).toBe(200);
  await expect(cell(page, move.s.day, move.s.period).locator(`[data-entry-id="${move.e.id}"]`)).toBeVisible();
  await expect(lesson(page, move.e.id)).toContainText("Manual");

  // SWAP via select → choose target → confirm: two lessons whose teachers are free in each other's slots.
  all = await entries();
  const ours = all.filter((e) => e.sectionId === section && !e.isLocked);
  let pair: [Entry, Entry] | null = null;
  for (const a of ours)
    for (const b of ours)
      if (!pair && a.subjectId !== b.subjectId && !busy(all, a.teacherId, b.dayOfWeek, b.periodNumber, [a.id, b.id]) && !busy(all, b.teacherId, a.dayOfWeek, a.periodNumber, [a.id, b.id]))
        pair = [a, b];
  expect(pair, "a legal swap exists").toBeTruthy();
  const [a, b] = pair!;
  await lesson(page, a.id).getByRole("button", { name: /^Select / }).click();
  await cell(page, b.dayOfWeek, b.periodNumber).getByRole("button", { name: "Swap here" }).click();
  const swapResponse = page.waitForResponse((r) => r.url().includes("/moves") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Confirm swap" }).click();
  const swapBody = (await swapResponse).request().postDataJSON();
  expect(swapBody).toMatchObject({ entryId: a.id, swapWithEntryId: b.id, to: { dayOfWeek: b.dayOfWeek, periodNumber: b.periodNumber } });
  await expect(cell(page, b.dayOfWeek, b.periodNumber).locator(`[data-entry-id="${a.id}"]`)).toBeVisible();
  await expect(cell(page, a.dayOfWeek, a.periodNumber).locator(`[data-entry-id="${b.id}"]`)).toBeVisible();

  // UNDO the swap = the same swap again.
  const undoResponse = page.waitForResponse((r) => r.url().includes("/moves") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await undoResponse).request().postDataJSON()).toMatchObject({ entryId: a.id, swapWithEntryId: b.id, to: { dayOfWeek: a.dayOfWeek, periodNumber: a.periodNumber } });
  await expect(cell(page, a.dayOfWeek, a.periodNumber).locator(`[data-entry-id="${a.id}"]`)).toBeVisible();
  await expect(page.getByTestId("editor-notice")).toContainText("Undid the swap");

  // LOCK one lesson, then UNDO (unlock the recorded id).
  const lockButton = lesson(page, a.id).getByRole("button", { name: /^Lock / });
  const lockResponse = page.waitForResponse((r) => r.url().includes("/locks") && r.request().method() === "PUT");
  await lockButton.click();
  expect((await lockResponse).request().postDataJSON()).toMatchObject({ entryIds: [a.id], locked: true });
  await expect(lesson(page, a.id).getByRole("button", { name: /^Unlock / })).toHaveAttribute("aria-pressed", "true");
  const unlockResponse = page.waitForResponse((r) => r.url().includes("/locks") && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await unlockResponse).request().postDataJSON()).toMatchObject({ entryIds: [a.id], locked: false });
  await expect(lesson(page, a.id).getByRole("button", { name: /^Lock / })).toHaveAttribute("aria-pressed", "false");

  // Lock all shown, then unlock all shown.
  await page.getByRole("button", { name: "Lock all shown", exact: true }).click();
  await expect(page.getByTestId("totals")).toContainText(`${SUBJECTS.length * PERIODS_PER_SUBJECT} locked`);
  await page.getByRole("button", { name: "Unlock all shown" }).click();
  await expect(page.getByTestId("totals")).not.toContainText("locked");
  expect(await forbiddenControls(page)).toEqual([]);
});

test("refused moves: TEACHER_BUSY / SLOT_OCCUPIED and a simulated REVISION_CONFLICT", async ({ page }) => {
  const section = sectionIds[0];
  await page.goto(`/years/${yearId}/timetables/${versionId}?view=section&id=${section}&mode=edit`);
  await expect(page.getByTestId("drop-cell")).toHaveCount(30);

  const all = await entries();
  const mine = all.filter((e) => e.sectionId === section && !e.isLocked);
  const free = freeSlots(all, section);
  const blocked = mine.flatMap((e) => free.filter((s) => busy(all, e.teacherId, s.day, s.period, [e.id])).map((s) => ({ e, s })))[0];
  const target = blocked ?? { e: mine[0], s: free[0] };

  test.info().annotations.push({ type: "refusal", description: blocked ? "real TEACHER_BUSY" : "simulated SLOT_OCCUPIED" });
  if (blocked) {
    // A real refusal: the teacher teaches the other class then.
    await lesson(page, target.e.id).getByRole("button", { name: /^Select / }).click();
    await page.getByRole("button", { name: `Move here: ${target.s.day.slice(0, 1)}${target.s.day.slice(1, 3).toLowerCase()} P${target.s.period}` }).click();
    await page.getByRole("button", { name: "Confirm move" }).click();
    await expect(page.getByTestId("editor-notice")).toContainText("The teacher is busy then");
  } else {
    // No naturally conflicting slot in this solution: simulate SLOT_OCCUPIED with an occupant to offer a swap.
    await page.route(
      (url) => url.pathname.startsWith(`/api/timetable-versions/${versionId}/moves`),
      (route) => route.fulfill({ status: 409, json: { success: false, message: "Slot occupied", data: { code: "SLOT_OCCUPIED", occupantEntryId: mine[1].id } } }),
      { times: 1 },
    );
    await dragTo(page, target.e.id, target.s.day, target.s.period);
    await expect(page.getByTestId("editor-notice")).toContainText("That slot is already taken");
    await expect(page.getByRole("button", { name: "Swap instead" })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss message" }).click();
  }
  // Nothing moved.
  await expect(cell(page, target.e.dayOfWeek, target.e.periodNumber).locator(`[data-entry-id="${target.e.id}"]`)).toBeVisible();

  // REVISION_CONFLICT (simulated): reload and tell the user; never shown as saved.
  await page.route(
    (url) => url.pathname.startsWith(`/api/timetable-versions/${versionId}/moves`),
    (route) => route.fulfill({ status: 409, json: { success: false, message: "Conflict", data: { code: "REVISION_CONFLICT", revision: 99, status: "DRAFT" } } }),
    { times: 1 },
  );
  const legal = mine.flatMap((e) => free.filter((s) => !busy(all, e.teacherId, s.day, s.period, [e.id])).map((s) => ({ e, s })))[0];
  await dragTo(page, legal.e.id, legal.s.day, legal.s.period);
  await expect(page.getByTestId("editor-notice")).toContainText("Someone else changed this timetable");
  await expect(cell(page, legal.e.dayOfWeek, legal.e.periodNumber).locator(`[data-entry-id="${legal.e.id}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("copy to new draft, then delete that draft", async ({ page }) => {
  await page.goto(`/years/${yearId}/timetables`);
  await expect(page.getByRole("link", { name: `Version ${versionNumber}`, exact: true })).toBeVisible();
  expect(await forbiddenControls(page)).toEqual([]);
  await page.getByRole("button", { name: `More actions for version ${versionNumber}` }).click();
  await page.getByRole("menuitem", { name: "Copy to new draft" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`Copy version ${versionNumber} to a new draft`);
  await dialog.getByLabel("Unlock every lesson").check();
  const cloneResponse = page.waitForResponse((r) => r.url().includes(`/api/timetable-versions/${versionId}/clone`));
  await dialog.getByRole("button", { name: "Copy to new draft" }).click();
  const clone = await (await cloneResponse).json();
  expect(clone.data.lockMode).toBe("NONE");
  await expect(page).toHaveURL(new RegExp(`/timetables/${clone.data.id}`));
  await expect(page.getByRole("heading", { name: `Version ${clone.data.versionNumber}` })).toBeVisible();

  await page.goto(`/years/${yearId}/timetables`);
  await page.getByRole("button", { name: `More actions for version ${clone.data.versionNumber}` }).click();
  await page.getByRole("menuitem", { name: "Delete version" }).click();
  const deleteRequest = page.waitForRequest((r) => r.url().includes(`/api/timetable-versions/${clone.data.id}`) && r.method() === "DELETE");
  await page.getByRole("alertdialog").getByRole("button", { name: `Delete version ${clone.data.versionNumber}` }).click();
  expect((await deleteRequest).postData()).toBeNull(); // a draft delete sends no body
  await expect(page.getByRole("link", { name: `Version ${clone.data.versionNumber}`, exact: true })).toHaveCount(0);
});

test("publish the generated draft (own year only) and show the substitution summary", async ({ page }) => {
  await page.goto(`/years/${yearId}/timetables/${versionId}`);
  await expect(page.getByText("No scheduling rule is broken")).toBeVisible();
  const publish = page.getByRole("button", { name: `Publish version ${versionNumber}` });
  await expect(publish).toBeEnabled();
  await publish.click();
  const before = await call<Array<{ id: string; status: string }>>("GET", `/api/timetable-versions?academicYearId=${yearId}`);
  const currentPublished = before.find((v) => v.status === "PUBLISHED")?.id ?? null;
  const publishRequest = page.waitForRequest((r) => r.url().includes(`/api/timetable-versions/${versionId}/publish`));
  await page.getByRole("alertdialog").getByRole("button", { name: "Publish", exact: true }).click();
  expect((await publishRequest).postDataJSON()).toMatchObject({ expectedPublishedVersionId: currentPublished });
  await expect(page.getByText(`Version ${versionNumber} is now the published timetable`)).toBeVisible();
  await expect(page.getByRole("link", { name: /daily operations/i })).toBeVisible();

  await page.goto(`/years/${yearId}/timetables`);
  await expect(page.getByRole("heading", { name: `Published timetable: version ${versionNumber}` })).toBeVisible();
  // P6: no delete for the published version.
  await page.getByRole("button", { name: `More actions for version ${versionNumber}` }).click();
  await expect(page.getByRole("menuitem", { name: "Delete version" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("seeded ACTIVE year: published timetable viewable, generation closed (read-only)", async ({ page }) => {
  await page.goto(`/years/${ACTIVE_YEAR_ID}/timetables`);
  await page.getByRole("link", { name: "View published timetable" }).click();
  await expect(page.getByTestId("timetable-grid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit timetable" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Publish version/ })).toHaveCount(0);
  expect(await forbiddenControls(page)).toEqual([]);

  await page.goto(`/years/${ACTIVE_YEAR_ID}/generate`);
  await expect(page.getByText("Generation is closed for this year")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate timetable" })).toHaveCount(0);
  expect(await forbiddenControls(page)).toEqual([]);
});
