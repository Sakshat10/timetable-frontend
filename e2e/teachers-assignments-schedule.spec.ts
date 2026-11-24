import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { forbiddenControls } from "./support/boundaries";

/**
 * Teachers (+ eligibility), Assignments and Schedule against the shared real backend.
 * Data ownership: only teachers named "QA-T …" (codes "QAT-…") are created and removed here; eligibility, pins and the
 * schedule are written only on the DRAFT year 2027-28, and only for teachers this spec created. The schedule is restored.
 */
const DRAFT_YEAR = "727f70f5-dcc0-4a43-ba8d-d20c0499ab5d"; // 2027-28
const ACTIVE_YEAR = "f19dcf01-f5e9-4c82-a6e9-6dc898af7240"; // 2026-27
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const STATE = "e2e/.auth/admin.json";

test.describe.configure({ mode: "serial" });

let api: APIRequestContext;
type ScheduleRow = { id: string; workingDays: string[]; periodsPerDay: number; breakAfterPeriod: number | null; legacy: boolean };
let originalSchedule: ScheduleRow | null = null;

async function data<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  const body = (await response.json()) as { data: T };
  return body.data;
}

async function schedule(): Promise<ScheduleRow | null> {
  const rows = await data<ScheduleRow[]>(await api.get(`/api/schedule-configs?academicYearId=${DRAFT_YEAR}`));
  return rows[0] ?? null;
}

async function qaTeachers() {
  const teachers = await data<Array<{ id: string; name: string }>>(await api.get("/api/teachers"));
  return teachers.filter((t) => t.name.startsWith("QA-T "));
}

async function removeQaTeachers() {
  for (const teacher of await qaTeachers()) {
    const pins = await data<Array<{ id: string }>>(await api.get(`/api/section-subject-teachers?teacherId=${teacher.id}`));
    for (const pin of pins) await api.delete(`/api/section-subject-teachers/${pin.id}`);
    await api.delete(`/api/teachers/${teacher.id}`);
  }
}

async function createTeacher(name: string, employeeCode: string) {
  const response = await api.post("/api/teachers", { data: { name, employeeCode } });
  expect(response.status()).toBe(201);
  return data<{ id: string; name: string }>(response);
}

const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });

test.beforeAll(async ({ baseURL }) => {
  api = await request.newContext({ baseURL, storageState: STATE });
  originalSchedule = await schedule();
  await removeQaTeachers(); // leftovers of an interrupted earlier run (own records only)
});

test.afterAll(async () => {
  await removeQaTeachers();
  const now = await schedule();
  if (originalSchedule === null && now) {
    await api.delete(`/api/schedule-configs/${now.id}`);
  } else if (originalSchedule && now && !originalSchedule.legacy && originalSchedule.breakAfterPeriod !== null) {
    await api.patch(`/api/schedule-configs/${now.id}`, {
      data: { workingDays: originalSchedule.workingDays, periodsPerDay: originalSchedule.periodsPerDay, breakAfterPeriod: originalSchedule.breakAfterPeriod },
    });
  }
  await api.dispose();
});

test("teacher create, edit, deactivate, reactivate and delete", async ({ page }) => {
  const name = `QA-T Alpha ${RUN}`;
  await page.goto(`/years/${DRAFT_YEAR}/teachers`);
  await expect(page.getByRole("heading", { name: "Teachers", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Add teacher" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Employee code (optional)").fill(`qat-a${RUN}`);
  await dialog.getByRole("button", { name: "Add teacher" }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel("Search teachers").fill(name);
  await expect(row(page, name)).toContainText(`QAT-A${RUN}`);
  await expect(row(page, name)).toContainText("Active");

  // Edit: rename and clear the employee code (sent as null).
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await dialog.getByLabel("Name").fill(`${name} Edited`);
  await dialog.getByLabel("Employee code (optional)").fill("");
  const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/api/teachers/"));
  await dialog.getByRole("button", { name: "Save changes" }).click();
  expect((await patch).postDataJSON()).toEqual({ name: `${name} Edited`, employeeCode: null });
  await expect(dialog).toBeHidden();
  const edited = `${name} Edited`;
  await expect(row(page, edited)).toContainText("None");

  // Deactivate: the confirmation explains the consequences.
  await page.getByRole("button", { name: `Actions for ${edited}` }).click();
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("can’t be pinned to new classes");
  await expect(confirm).toContainText("never chooses them automatically");
  await expect(confirm).toContainText("generating a timetable is refused");
  await confirm.getByRole("button", { name: "Deactivate" }).click();
  await expect(confirm).toBeHidden();
  await expect(row(page, edited)).toHaveCount(0); // default filter: active
  await page.getByRole("combobox", { name: "Show teachers" }).click();
  await page.getByRole("option", { name: "Inactive" }).click();
  await expect(row(page, edited)).toContainText("Inactive");

  // Reactivate.
  await page.getByRole("button", { name: `Actions for ${edited}` }).click();
  await page.getByRole("menuitem", { name: "Reactivate" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row(page, edited)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Show teachers" }).click();
  await page.getByRole("option", { name: "All teachers" }).click();
  await expect(row(page, edited)).toContainText("Active");

  // Delete (no history).
  await page.getByRole("button", { name: `Actions for ${edited}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("deactivate them instead");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete teacher" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row(page, edited)).toHaveCount(0);
  expect((await qaTeachers()).some((t) => t.name === edited)).toBe(false);
});

test("bulk add maps a duplicate-code row error, then succeeds", async ({ page }) => {
  await page.goto(`/years/${DRAFT_YEAR}/teachers`);
  await page.getByRole("button", { name: "Add several" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Row 1 name").fill(`QA-T Bulk One ${RUN}`);
  await dialog.getByLabel("Row 1 employee code").fill(`QAT-B1${RUN}`);
  await dialog.getByLabel("Row 2 name").fill(`QA-T Bulk Two ${RUN}`);
  await dialog.getByLabel("Row 2 employee code").fill("T001"); // a seeded teacher's code

  const first = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/teachers/bulk"));
  await dialog.getByRole("button", { name: "Add 2 teachers" }).click();
  const firstKey = (await first).headers()["idempotency-key"];
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(dialog.getByText(/already exists in this school/)).toBeVisible();
  await expect(dialog.getByLabel("Row 2 employee code")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("Nothing was added");

  await dialog.getByLabel("Row 2 employee code").fill(`QAT-B2${RUN}`);
  const second = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/teachers/bulk"));
  await dialog.getByRole("button", { name: "Add 2 teachers" }).click();
  expect((await second).headers()["idempotency-key"]).not.toBe(firstKey); // a definitive refusal ends that submission
  await expect(dialog).toBeHidden();
  await expect(page.getByText("2 teachers added")).toBeVisible();
  const names = (await qaTeachers()).map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining([`QA-T Bulk One ${RUN}`, `QA-T Bulk Two ${RUN}`]));
});

test("subject link and grade eligibility; pin and unpin an assignment", async ({ page }) => {
  const teacher = await createTeacher(`QA-T Elig ${RUN}`, `QAT-E${RUN}`);
  await page.goto(`/years/${DRAFT_YEAR}/teachers/${teacher.id}`);
  await expect(page.getByRole("heading", { name: teacher.name, level: 1 })).toBeVisible();
  await expect(page.getByText("Eligibility decides which teachers the generator may choose; it does not assign them to a class.")).toBeVisible();

  await page.getByRole("button", { name: "Add subject" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Subject" }).click();
  await page.getByRole("option", { name: "Mathematics (MATH)" }).click();
  await expect(dialog.getByRole("radio", { name: "Selected grades" })).toBeChecked();
  await dialog.getByRole("button", { name: "Add subject" }).click();
  await expect(dialog).toBeHidden();

  const mathRow = page.getByTestId("link-row-MATH");
  await expect(mathRow).toContainText("Not eligible for any grade yet");
  await mathRow.getByRole("checkbox", { name: "Mathematics: eligible for Class 11" }).click();
  await expect(mathRow).not.toContainText("Not eligible for any grade yet");
  await expect(mathRow.getByRole("checkbox", { name: "Mathematics: eligible for Class 11" })).toBeChecked();
  await expect(mathRow.getByRole("checkbox", { name: "Mathematics: eligible for Grade 8" })).not.toBeChecked();
  await expect(page.getByText("Not pinned to any class")).toBeVisible();

  // Assignments: unpinned cells read "Automatic", never a teacher name.
  await page.goto(`/years/${DRAFT_YEAR}/assignments`);
  await expect(page.getByText(/Optional: pin a specific teacher/)).toBeVisible();
  // A Grade 8 cell: the teacher is listed but disabled (eligible for Class 11 only).
  await page.getByRole("button", { name: /^Mathematics, Section A: pinned to .*Edit pin$/ }).click();
  const pinDialog = page.getByRole("dialog");
  const ineligible = pinDialog.getByRole("radio", { name: new RegExp(teacher.name) });
  await expect(ineligible).toBeDisabled();
  await expect(ineligible).toHaveAccessibleDescription("Not eligible for Grade 8");
  await pinDialog.getByRole("button", { name: "Cancel" }).click();

  const cell = page.getByRole("button", { name: "Mathematics, Commerce A: automatic. Pin a teacher" });
  await expect(cell).toHaveText("Automatic");
  await cell.click();
  await expect(pinDialog).toContainText("Pinning is optional");
  await pinDialog.getByRole("radio", { name: new RegExp(teacher.name) }).click();
  await pinDialog.getByRole("button", { name: "Pin teacher" }).click();
  await expect(pinDialog).toBeHidden();
  const pinned = page.getByRole("button", { name: `Mathematics, Commerce A: pinned to ${teacher.name}. Edit pin` });
  await expect(pinned).toBeVisible();

  // The teacher page lists the pin read-only.
  await page.goto(`/years/${DRAFT_YEAR}/teachers/${teacher.id}`);
  await expect(page.getByRole("table", { name: `${teacher.name}’s pinned classes` })).toContainText("Class 11 · Commerce A");

  // Unpin: back to automatic.
  await page.goto(`/years/${DRAFT_YEAR}/assignments`);
  await page.getByRole("button", { name: `Mathematics, Commerce A: pinned to ${teacher.name}. Edit pin` }).click();
  await pinDialog.getByRole("button", { name: "Unpin" }).click();
  await expect(pinDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Mathematics, Commerce A: automatic. Pin a teacher" })).toHaveText("Automatic");
  expect(await data<unknown[]>(await api.get(`/api/section-subject-teachers?teacherId=${teacher.id}`))).toEqual([]);
});

test("the ACTIVE year shows setup locked (read-only)", async ({ page }) => {
  const teacher = (await qaTeachers()).find((t) => t.name.startsWith("QA-T Elig"));
  await page.goto(`/years/${ACTIVE_YEAR}/assignments`);
  await expect(page.getByText(/Setup is locked once a year is activated/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Pin a teacher|Edit pin/ })).toHaveCount(0);

  await page.goto(`/years/${ACTIVE_YEAR}/schedule`);
  await expect(page.getByText(/Setup is locked once a year is activated/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Save|Reset schedule/ })).toHaveCount(0);
  await expect(page.getByLabel("Periods per day")).toBeDisabled();
  await expect(page.locator('input[type="time"]')).toHaveCount(0);

  if (teacher) {
    await page.goto(`/years/${ACTIVE_YEAR}/teachers/${teacher.id}`);
    await expect(page.getByText(/Grade eligibility for 2026-27 can’t be changed/)).toBeVisible();
    for (const box of await page.getByRole("checkbox", { name: /Mathematics: eligible for/ }).all()) await expect(box).toBeDisabled();
  }
});

test("schedule edit with a validation error; values restored afterwards", async ({ page }) => {
  const before = await schedule();
  await page.goto(`/years/${DRAFT_YEAR}/schedule`);
  await expect(page.getByRole("heading", { name: "Schedule", level: 1 })).toBeVisible();
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  const save = page.getByRole("button", { name: before ? "Save changes" : "Save schedule" });

  // Validation: 13 periods is refused before sending.
  let sent = false;
  page.on("request", (r) => {
    if (r.url().includes("/api/schedule-configs") && r.method() !== "GET") sent = true;
  });
  await page.getByLabel("Periods per day").fill("13");
  await save.click();
  await expect(page.getByText("Enter a whole number from 2 to 12")).toBeVisible();
  expect(sent).toBe(false);

  // A valid edit: 7 periods, break after P3, Saturday toggled.
  await page.getByLabel("Periods per day").fill("7");
  await page.getByRole("combobox", { name: "Break after" }).click();
  await page.getByRole("option", { name: "P3", exact: true }).click();
  const saturday = page.getByRole("button", { name: "Saturday" });
  const saturdayWasOn = (await saturday.getAttribute("aria-pressed")) === "true";
  await saturday.click();
  const dayCount = (before?.workingDays.length ?? 5) + (saturdayWasOn ? -1 : 1);
  await expect(page.getByText(String(dayCount * 7), { exact: true })).toBeVisible(); // live capacity
  await expect(page.getByRole("list", { name: "Day preview" }).getByRole("listitem")).toHaveCount(8); // P1..P7 + break

  const write = page.waitForRequest((r) => r.url().includes("/api/schedule-configs") && r.method() !== "GET");
  await save.click();
  const request = await write;
  if (before) {
    expect(request.method()).toBe("PATCH");
    expect(Object.keys(request.postDataJSON() as object).sort()).toEqual(
      expect.arrayContaining(["workingDays"]), // only changed fields are sent
    );
  } else {
    expect(request.method()).toBe("POST");
  }
  await expect(page.getByText("Schedule saved")).toBeVisible();
  const after = await schedule();
  expect(after?.periodsPerDay).toBe(7);
  expect(after?.breakAfterPeriod).toBe(3);

  // Lowering periods below the break sends the break too.
  await page.getByLabel("Periods per day").fill("3");
  const lower = page.waitForRequest((r) => r.url().includes("/api/schedule-configs") && r.method() === "PATCH");
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await lower).postDataJSON()).toEqual({ periodsPerDay: 3, breakAfterPeriod: 2 });
  await expect(page.getByRole("list", { name: "Day preview" }).getByRole("listitem")).toHaveCount(4);

  // Restore: reset when there was no schedule (through the UI), otherwise afterAll PATCHes the original values back.
  if (!before) {
    await page.getByRole("button", { name: "Reset schedule" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reset schedule" }).click();
    await expect(page.getByRole("button", { name: "Save schedule" })).toBeVisible();
    expect(await schedule()).toBeNull();
  }
});

test("a server error shows the generic message with a retry", async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/api/teachers",
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ success: false, message: "PrismaClientKnownRequestError: secret internals" }) })
        : route.fallback(),
  );
  await page.goto(`/years/${DRAFT_YEAR}/teachers`);
  await expect(page.getByText("Couldn’t load teachers")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("The server could not complete the request. Please try again in a moment.")).toBeVisible();
  await expect(page.getByText(/Prisma|secret internals/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("no forbidden controls or wording on these pages", async ({ page }) => {
  for (const path of ["teachers", "assignments", "schedule"]) {
    await page.goto(`/years/${DRAFT_YEAR}/${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await forbiddenControls(page)).toEqual([]);
    await expect(page.getByText(/workload/i)).toHaveCount(0);
  }
});
