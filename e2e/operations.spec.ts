import { expect, request, test, type Page } from "@playwright/test";
import { forbiddenControls } from "./support/boundaries";
import { seed } from "./support/seed";

/**
 * Daily operations against the real disposable backend.
 *
 * DATA OWNERSHIP: seeded covers/absences are only read. Every absence this spec records is on wd["2"]..wd["4"]
 * for seeded teachers and is cancelled in afterAll (after removing any manual assignment this spec made).
 * The dates and periods used are DERIVED from the published timetable in beforeAll (never hard-coded), so the
 * spec survives a reseed: a day on which Deepak teaches at least two lessons, and Arjun's first two lessons on
 * another day.
 */
const m = seed();
const wd = m.dates.wd;
let D3 = wd["3"]!; // Deepak's full-day absence date (re-derived in beforeAll)
let D4 = wd["4"]!; // Arjun's periods absence date (re-derived in beforeAll)
let DEEPAK_FIRST = 1;
let DEEPAK_LAST = 6;
let DEEPAK_COUNT = 2;
let ARJUN_RANGE: [number, number] = [3, 4];
let ARJUN_OVERLAP: [number, number] = [4, 5];
const D2 = wd["2"]!;
const teachers = m.teachers as Record<string, { id: string; name: string; employeeCode: string }>;
const DEEPAK = teachers.deepak!;
const ARJUN = teachers.arjun!;
const LATA = teachers.lata!;

const createdAbsences: string[] = [];
const createdUnavailability: string[] = [];

test.describe.configure({ mode: "serial" });

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

test.beforeAll(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" });
  const versions = await (await api.get(`/api/timetable-versions?academicYearId=${m.academicYears.current.id}&status=PUBLISHED`)).json();
  const published = versions.data[0].id as string;
  async function lessonsOn(teacherId: string, date: string): Promise<number[]> {
    const view = await (await api.get(`/api/timetable-versions/${published}/timetable?view=teacher&id=${teacherId}`)).json();
    return (view.data.cells as Array<{ dayOfWeek: string; periodNumber: number; lesson: unknown }>)
      .filter((c) => c.dayOfWeek === weekday(date) && c.lesson)
      .map((c) => c.periodNumber)
      .sort((a, b) => a - b);
  }
  // Deepak: a working day (not wd0/wd1, which hold seeded covers) on which he teaches at least two lessons.
  for (const key of ["3", "2", "4"]) {
    const periods = await lessonsOn(DEEPAK.id, wd[key]!);
    if (periods.length >= 2) {
      D3 = wd[key]!;
      DEEPAK_FIRST = periods[0]!;
      DEEPAK_LAST = periods[periods.length - 1]!;
      DEEPAK_COUNT = periods.length;
      break;
    }
  }
  // Arjun: a different day with at least two lessons; absent for exactly his first two lessons.
  for (const key of ["4", "2", "3"]) {
    if (wd[key] === D3) continue;
    const periods = await lessonsOn(ARJUN.id, wd[key]!);
    if (periods.length >= 2) {
      D4 = wd[key]!;
      ARJUN_RANGE = [periods[0]!, periods[1]!];
      ARJUN_OVERLAP = [periods[1]!, periods[1]!];
      break;
    }
  }
  await api.dispose();
});

test.afterAll(async ({ baseURL }) => {
  const api = await request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" });
  for (const id of createdAbsences) {
    const covers = await (await api.get(`/api/substitutions?absenceId=${id}&status=ASSIGNED&limit=500`)).json();
    for (const cover of covers.data?.items ?? []) {
      if (cover.assignmentSource === "MANUAL") await api.delete(`/api/substitutions/${cover.id}/assignment`);
    }
    const absence = await (await api.get(`/api/teacher-absences/${id}`)).json();
    if (absence.data?.status === "ACTIVE") {
      const res = await api.post(`/api/teacher-absences/${id}/cancel`);
      expect(res.ok(), `cancel absence ${id}`).toBeTruthy();
    }
  }
  for (const id of createdUnavailability) {
    const list = await (await api.get(`/api/teacher-unavailability?teacherId=${LATA.id}&from=${D2}&to=${D2}`)).json();
    if ((list.data ?? []).some((u: { id: string }) => u.id === id)) await api.delete(`/api/teacher-unavailability/${id}`);
  }
  await api.dispose();
});

function teacherOption(t: { name: string; employeeCode: string }) {
  return `${t.name} (${t.employeeCode})`;
}

async function openRecordSheet(page: Page) {
  await page.goto("/operations/absences");
  await expect(page.getByRole("heading", { name: "Absences", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Record absence" }).first().click();
  await expect(page.getByRole("dialog", { name: "Record absence" })).toBeVisible();
  // The title changes after saving ("Absence recorded"), so keep a locator that does not depend on it.
  return page.getByRole("dialog");
}

async function fillAbsence(page: Page, t: { name: string; employeeCode: string }, date: string, periods?: [number, number]) {
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Teacher" }).click();
  await page.getByRole("option", { name: teacherOption(t) }).click();
  await sheet.getByLabel("First day").fill(date);
  await sheet.getByLabel("Last day").fill(date);
  if (periods) {
    await sheet.getByRole("radio", { name: "Some periods" }).click();
    await sheet.getByLabel("From period").fill(String(periods[0]));
    await sheet.getByLabel("To period").fill(String(periods[1]));
  }
  // Keep the covers open so this spec controls every assignment.
  await sheet.getByRole("checkbox", { name: "Assign substitutes automatically" }).click();
  await expect(sheet.getByRole("checkbox", { name: "Assign substitutes automatically" })).not.toBeChecked();
}

async function rememberAbsence(page: Page) {
  const href = await page.getByRole("dialog").getByRole("link", { name: "View absence" }).getAttribute("href");
  const id = href?.split("/").pop();
  expect(id).toBeTruthy();
  createdAbsences.push(id!);
  return id!;
}

async function openTeacherGroup(page: Page, date: string, teacherName: string) {
  await page.goto(`/operations?date=${date}`);
  await page.getByRole("radio", { name: "By absent teacher" }).click();
  const group = page.getByRole("region", { name: new RegExp(teacherName) });
  await expect(group).toBeVisible();
  return group;
}

/** The board's heading for a calendar date, computed (never hard-coded) so the spec survives a reseed. */
function showing(date: string): RegExp {
  const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  return new RegExp(`^Showing ${label.replace(",", ",?")}`);
}

test("the board shows the seeded covers for the reference day, labels the date and has the updates bell", async ({ page }) => {
  await page.goto(`/operations?date=${wd["0"]}`);
  await expect(page).toHaveTitle(/Daily cover/);
  await expect(page.getByRole("heading", { name: showing(wd["0"]!) })).toBeVisible();
  await expect(page.getByText("Dates follow the server’s calendar (UTC)")).toBeVisible();
  await expect(page.getByTestId("cover-row").filter({ hasText: "Imran Khan" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Substitution updates/ })).toBeVisible();

  // Date navigation across days (UTC): next day, then back.
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${wd["1"]}`));
  await expect(page.getByRole("heading", { name: showing(wd["1"]!) })).toBeVisible();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${wd["0"]}`));

  expect(await forbiddenControls(page)).toEqual([]);
});

test("records a full-day absence: lessons preview, covers created and the allocation notice", async ({ page }) => {
  const sheet = await openRecordSheet(page);
  await fillAbsence(page, DEEPAK, D3);
  const preview = sheet.getByText("Lessons from the published timetable").locator("..");
  await expect(preview).toContainText(`P${DEEPAK_FIRST}`);
  await expect(preview).toContainText(`P${DEEPAK_LAST}`);
  await sheet.getByRole("button", { name: "Record absence" }).click();

  await expect(page.getByRole("dialog", { name: "Absence recorded" })).toBeVisible();
  await expect(sheet.getByText(`${DEEPAK_COUNT} lessons now need cover`)).toBeVisible();
  await expect(sheet.getByText("Automatic assignment was off")).toBeVisible();
  const id = await rememberAbsence(page);

  await page.goto(`/operations/absences/${id}`);
  await expect(page.getByRole("heading", { name: `${DEEPAK.name}’s absence` })).toBeVisible();
  await expect(page.getByText("Affected lessons", { exact: true }).locator("../..")).toContainText("2");
  await page.getByRole("link", { name: new RegExp(`Open period ${DEEPAK_FIRST} .* in daily cover`) }).click();
  await expect(page).toHaveURL(new RegExp(`date=${D3}.*cover=`));
  await expect(page.getByRole("dialog", { name: new RegExp(`Period ${DEEPAK_FIRST}\\b`) })).toBeVisible();
});

test("opens a cover, shows tiered candidates, assigns, replaces and unassigns", async ({ page }) => {
  const group = await openTeacherGroup(page, D3, DEEPAK.name);
  await group.getByRole("button", { name: new RegExp(`^Find substitute: period ${DEEPAK_FIRST}\\b`) }).click();
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${DEEPAK_FIRST}\\b`) });
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
  await expect(sheet.getByRole("heading", { name: /^(Same subject|Other available teachers)/ }).first()).toBeVisible();
  await expect(sheet.getByText("School setting:")).toBeVisible();
  await expect(sheet.getByText("Periods this week").first()).toBeVisible();
  await expect(sheet.getByText(/Teachers who can’t cover this lesson/)).toBeVisible();

  const first = sheet.getByRole("button", { name: /^Assign / }).first();
  const firstName = ((await first.textContent()) ?? "").replace(/^Assign /, "").trim();
  await first.click();
  await expect(sheet.getByRole("heading", { name: "Choose a different substitute" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: `Unassign ${firstName}` })).toBeVisible();
  await expect(sheet.getByText(`Substitute assigned: ${firstName}`)).toBeVisible();

  const replace = sheet.getByRole("button", { name: /^Use .* instead$/ }).first();
  const secondName = ((await replace.textContent()) ?? "").replace(/^Use /, "").replace(/ instead$/, "").trim();
  await replace.click();
  await expect(sheet.getByRole("button", { name: `Unassign ${secondName}` })).toBeVisible();
  await expect(sheet.getByText(`Substitute replaced: ${firstName} → ${secondName}`)).toBeVisible();

  await sheet.getByRole("button", { name: `Unassign ${secondName}` }).click();
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
  await expect(sheet.getByText(`Substitute removed: ${secondName}`)).toBeVisible();
});

test("asks for an explicit confirmation when the server requires one for four consecutive periods", async ({ page }) => {
  const group = await openTeacherGroup(page, D3, DEEPAK.name);
  await group.getByRole("button", { name: new RegExp(`^Find substitute: period ${DEEPAK_LAST}\\b`) }).click();
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${DEEPAK_LAST}\\b`) });
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
  const coverId = new URL(page.url()).searchParams.get("cover")!;

  const bodies: Array<Record<string, unknown>> = [];
  await page.route(
    (url) => url.pathname === `/api/substitutions/${coverId}/assignment`,
    async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      bodies.push(body);
      if (body.confirmFourConsecutive !== true) {
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            message: "Assigning this teacher would give them 4 consecutive teaching periods (periods 3–6). Confirm to assign them anyway, or choose another teacher.",
            errors: { code: ["FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED"], periods: ["3", "4", "5", "6"] },
          }),
        });
      }
      return route.continue();
    },
  );

  const candidate = sheet.getByRole("button", { name: /^Assign / }).first();
  const name = ((await candidate.textContent()) ?? "").replace(/^Assign /, "").trim();
  await candidate.click();
  const confirm = page.getByRole("alertdialog", { name: `Assign ${name} as a last resort?` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("4 consecutive periods (P3, P4, P5 and P6)");
  await confirm.getByRole("button", { name: "Assign as last resort" }).click();
  await expect(confirm).toBeHidden();
  expect(bodies).toEqual([{ teacherId: expect.any(String) }, { teacherId: expect.any(String), confirmFourConsecutive: true }]);
  await expect(sheet.getByRole("button", { name: `Unassign ${name}` })).toBeVisible();
  await page.unrouteAll({ behavior: "wait" });

  await sheet.getByRole("button", { name: `Unassign ${name}` }).click();
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
});

test("cancels a cover with a reason and shows it with the cancelled toggle", async ({ page }) => {
  const group = await openTeacherGroup(page, D3, DEEPAK.name);
  await group.getByRole("button", { name: new RegExp(`^Find substitute: period ${DEEPAK_LAST}\\b`) }).click();
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${DEEPAK_LAST}\\b`) });
  await sheet.getByRole("button", { name: "Cancel cover" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel this cover?" });
  // A reserved system reason is explained without calling the server.
  await dialog.getByLabel("Reason (optional)").fill("absence_cancelled");
  await dialog.getByRole("button", { name: "Cancel cover" }).click();
  await expect(dialog.getByRole("alert")).toContainText("reserved");
  await dialog.getByLabel("Reason (optional)").fill("Class on a field trip");
  await dialog.getByRole("button", { name: "Cancel cover" }).click();
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeHidden();
  await expect(group.getByRole("button", { name: new RegExp(`period ${DEEPAK_LAST}\\b`) })).toHaveCount(0);

  await page.getByRole("switch", { name: "Show cancelled and obsolete" }).click();
  await expect(page.getByRole("region", { name: new RegExp(DEEPAK.name) }).getByRole("button", { name: new RegExp(`^View: period ${DEEPAK_LAST}\\b`) }).first()).toBeVisible();
});

test("assigns automatically for the day and shows the run counts", async ({ page }) => {
  await page.goto(`/operations?date=${D3}`);
  await page.getByRole("button", { name: "Assign automatically" }).click();
  const dialog = page.getByRole("dialog", { name: "Assign substitutes automatically" });
  await expect(dialog.getByText("Past dates are never assigned automatically.")).toBeVisible();
  await dialog.getByRole("button", { name: "Assign automatically" }).click();
  await expect(dialog.getByText("Automatic assignment finished.")).toBeVisible();
  for (const label of ["Considered", "Assigned", "Still need cover", "Conflicts", "Past dates skipped", "Held for review"]) {
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "Done" }).click();
});

test("records a periods absence, refuses an overlapping one and edits the reason", async ({ page }) => {
  const sheet = await openRecordSheet(page);
  await fillAbsence(page, ARJUN, D4, ARJUN_RANGE);
  await sheet.getByRole("button", { name: "Record absence" }).click();
  await expect(page.getByRole("dialog", { name: "Absence recorded" })).toBeVisible();
  await expect(sheet.getByText("2 lessons now need cover")).toBeVisible();
  const id = await rememberAbsence(page);

  await sheet.getByRole("button", { name: "Record another" }).click();
  await fillAbsence(page, ARJUN, D4, ARJUN_OVERLAP);
  await sheet.getByRole("button", { name: "Record absence" }).click();
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText("overlaps");
  await expect(alert.getByRole("link", { name: "Open the existing absence" })).toHaveAttribute("href", `/operations/absences/${id}`);
  await page.keyboard.press("Escape");

  await page.goto(`/operations/absences/${id}`);
  await expect(page.getByRole("heading", { name: `${ARJUN.name}’s absence` })).toBeVisible();
  await expect(page.getByText(`Periods ${ARJUN_RANGE[0]}–${ARJUN_RANGE[1]}`).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit absence" }).click();
  const edit = page.getByRole("dialog", { name: "Edit absence" });
  await expect(edit.getByRole("combobox", { name: "Teacher" })).toBeDisabled();
  await edit.getByLabel("Reason (optional)").fill("Training (e2e)");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog", { name: "Absence updated" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Training (e2e)")).toBeVisible();
});

test("cancels an absence from its detail page", async ({ page }) => {
  const id = createdAbsences[createdAbsences.length - 1]!;
  await page.goto(`/operations/absences/${id}`);
  await page.getByRole("button", { name: "Cancel absence" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel this absence?" });
  await dialog.getByRole("button", { name: "Cancel absence" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("adds and cancels unavailability", async ({ page }) => {
  await page.goto("/operations/unavailability");
  await expect(page.getByRole("heading", { name: "Unavailability", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Add unavailability" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add unavailability" });
  await dialog.getByRole("combobox", { name: "Teacher" }).click();
  await page.getByRole("option", { name: teacherOption(LATA) }).click();
  await dialog.getByLabel("Date").fill(D2);
  await dialog.getByRole("checkbox", { name: "Whole day" }).click();
  await dialog.getByLabel("Period").fill("7");
  await dialog.getByLabel("Reason (optional)").fill("Staff meeting (e2e)");
  const created = page.waitForResponse((r) => r.url().includes("/api/teacher-unavailability") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Add unavailability" }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  createdUnavailability.push((await response.json()).data.id);
  await expect(page.getByRole("dialog", { name: "Unavailability added" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const cancel = page.getByRole("button", { name: new RegExp(`Cancel unavailability for ${LATA.name} .* Period 7`) });
  await expect(cancel).toBeVisible();
  await cancel.click();
  const confirm = page.getByRole("alertdialog", { name: "Cancel this unavailability?" });
  await confirm.getByRole("button", { name: "Cancel unavailability" }).click();
  await expect(confirm).toBeHidden();
  await expect(cancel).toHaveCount(0);
});

test("a server failure shows a generic message without internals", async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/api/substitutions",
    (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: 'PrismaClientKnownRequestError: relation "cover_requests" at /srv/app/substitution.service.ts:512' }),
      }),
  );
  await page.goto(`/operations?date=${D3}`);
  const alert = page.getByRole("alert").filter({ hasText: "Couldn’t load the lessons for this date" });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText("The server could not complete the request");
  await expect(page.getByText(/Prisma|cover_requests|substitution\.service/)).toHaveCount(0);
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
});
