import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { seed } from "./support/seed";

/**
 * Absence, unavailability and assignment conflicts against the real disposable backend.
 *
 * DATA OWNERSHIP: everything is derived in beforeAll from the seed manifest and the ACTIVE year's published
 * timetable (no hard-coded ids, dates or periods). Teachers used here exclude Deepak, Arjun and Lata
 * (operations.spec.ts), inactive teachers, teachers already absent on wd["2"]..wd["4"] and teachers already
 * covering a lesson on those days. Every absence, manual assignment and unavailability created is undone in afterAll.
 */
const m = seed();
const wd = m.dates.wd;
const DAYS = ["2", "3", "4"].map((k) => wd[k]!);
const STATE = "e2e/.auth/admin.json";
const RESERVED = new Set(["deepak", "arjun", "lata"]);

interface Teacher {
  id: string;
  name: string;
  employeeCode: string | null;
  isActive: boolean;
}
interface CoverItem {
  id: string;
  periodNumber: number;
  date: string;
  status: string;
  assignmentSource: string | null;
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const weekday = (date: string) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
const option = (t: Teacher) => (t.employeeCode ? `${t.name} (${t.employeeCode})` : t.name);

// Derived in beforeAll.
let teachersById = new Map<string, Teacher>();
let D = ""; // date with two teachers (A and G) teaching in the same period P
let P = 0;
let A: Teacher;
let G: Teacher;
let C: Teacher; // multi-day absence
let C1 = "";
let C2 = "";
let E: Teacher; // unavailability
let EP = 0;

// Created during the run (undone in afterAll).
const absences: string[] = [];
const unavailability: string[] = [];
let absenceA = "";
let absenceG = "";
let absenceC = "";
let coverA = ""; // A's cover in period P, manually given to B
let coverG = ""; // G's cover in period P
let B: Teacher | null = null;

test.describe.configure({ mode: "serial" });

async function api(baseURL: string | undefined) {
  return request.newContext({ baseURL, storageState: STATE });
}

async function data<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, what: string): Promise<T> {
  const body = (await response.json()) as { data?: unknown };
  expect(response.ok(), `${what}: ${response.status()} ${JSON.stringify(body).slice(0, 300)}`).toBeTruthy();
  return body.data as T;
}

async function recordAbsence(ctx: APIRequestContext, body: Record<string, unknown>): Promise<string> {
  const result = await data<{ absence: { id: string } }>(await ctx.post("/api/teacher-absences", { data: { autoAssign: false, ...body } }), "record absence");
  absences.push(result.absence.id);
  return result.absence.id;
}

async function coversOf(ctx: APIRequestContext, absenceId: string): Promise<CoverItem[]> {
  return (await data<{ items: CoverItem[] }>(await ctx.get(`/api/substitutions?absenceId=${absenceId}&status=OPEN,ASSIGNED&limit=500`), "covers")).items;
}

/** Assigns the first directly assignable candidate (not last resort) other than `avoid`. */
async function assignFreeCandidate(ctx: APIRequestContext, coverId: string, avoid: Set<string>): Promise<string> {
  const c = await data<{ candidates: Array<{ id: string; tierKey: string; offered: boolean }> }>(await ctx.get(`/api/substitutions/${coverId}/candidates`), "candidates");
  const pick = c.candidates.find((x) => x.offered && x.tierKey !== "LAST_RESORT" && !avoid.has(x.id));
  expect(pick, "a free candidate").toBeTruthy();
  await data(await ctx.put(`/api/substitutions/${coverId}/assignment`, { data: { teacherId: pick!.id } }), "assign");
  return pick!.id;
}

test.beforeAll(async ({ baseURL }) => {
  const ctx = await api(baseURL);
  const all = await data<Teacher[]>(await ctx.get("/api/teachers"), "teachers");
  teachersById = new Map(all.map((t) => [t.id, t]));
  const reservedIds = new Set(Object.entries(m.teachers as Record<string, { id: string }>).filter(([k]) => RESERVED.has(k)).map(([, t]) => t.id));

  const busy = new Set<string>(reservedIds);
  const active = await data<Array<{ teacherId: string }>>(await ctx.get(`/api/teacher-absences?status=ACTIVE&from=${DAYS[0]}&to=${DAYS[2]}`), "absences");
  for (const a of active) busy.add(a.teacherId);
  const covering = await data<{ items: Array<{ replacementTeacher: { id: string } | null }> }>(
    await ctx.get(`/api/substitutions?from=${DAYS[0]}&to=${DAYS[2]}&status=ASSIGNED&limit=500`),
    "assigned covers",
  );
  for (const c of covering.items) if (c.replacementTeacher) busy.add(c.replacementTeacher.id);
  const eligible = all.filter((t) => t.isActive && !busy.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));

  const versions = await data<Array<{ id: string }>>(await ctx.get(`/api/timetable-versions?academicYearId=${m.academicYears.current.id}&status=PUBLISHED`), "versions");
  const published = versions[0]!.id;
  const lessons = new Map<string, Map<string, number[]>>(); // teacherId -> weekday -> periods
  for (const t of eligible) {
    const view = await data<{ cells: Array<{ dayOfWeek: string; periodNumber: number; lesson: unknown }> }>(
      await ctx.get(`/api/timetable-versions/${published}/timetable?view=teacher&id=${t.id}`),
      "teacher view",
    );
    const byDay = new Map<string, number[]>();
    for (const cell of view.cells) if (cell.lesson) byDay.set(cell.dayOfWeek, [...(byDay.get(cell.dayOfWeek) ?? []), cell.periodNumber].sort((a, b) => a - b));
    lessons.set(t.id, byDay);
  }
  const periodsOn = (t: Teacher, date: string) => lessons.get(t.id)?.get(weekday(date)) ?? [];

  // A and G: two eligible teachers teaching in the same period P on the same day D.
  search: for (const date of DAYS) {
    for (let p = 1; p <= 12; p++) {
      const teaching = eligible.filter((t) => periodsOn(t, date).includes(p));
      if (teaching.length >= 2) {
        D = date;
        P = p;
        A = teaching[0]!;
        G = teaching[1]!;
        break search;
      }
    }
  }
  expect(D, "two teachers teaching the same period on one day").not.toBe("");

  // C: lessons on two consecutive working days among wd2..wd4.
  for (const t of eligible) {
    if (t.id === A.id || t.id === G.id) continue;
    const pair = [0, 1].find((i) => periodsOn(t, DAYS[i]!).length > 0 && periodsOn(t, DAYS[i + 1]!).length > 0);
    if (pair !== undefined) {
      C = t;
      C1 = DAYS[pair]!;
      C2 = DAYS[pair + 1]!;
      break;
    }
  }
  expect(C, "a teacher with lessons on two consecutive working days").toBeTruthy();

  // E: anyone else; the period is one E has no lesson in on D (unavailability does not touch E's own lessons anyway).
  E = eligible.find((t) => ![A.id, G.id, C.id].includes(t.id))!;
  expect(E).toBeTruthy();
  EP = [1, 2, 3, 4, 5, 6, 7, 8].find((p) => !periodsOn(E, D).includes(p)) ?? 1;
  await ctx.dispose();
});

test.afterAll(async ({ baseURL }) => {
  const ctx = await api(baseURL);
  for (const id of absences) {
    const assigned = await (await ctx.get(`/api/substitutions?absenceId=${id}&status=ASSIGNED&limit=500`)).json();
    for (const cover of assigned.data?.items ?? []) {
      if (cover.assignmentSource === "MANUAL") await ctx.delete(`/api/substitutions/${cover.id}/assignment`);
    }
    const absence = await (await ctx.get(`/api/teacher-absences/${id}`)).json();
    if (absence.data?.status === "ACTIVE") expect((await ctx.post(`/api/teacher-absences/${id}/cancel`)).ok(), `cancel absence ${id}`).toBeTruthy();
  }
  for (const id of unavailability) {
    const list = await (await ctx.get(`/api/teacher-unavailability?teacherId=${E.id}&from=${D}&to=${D}`)).json();
    if ((list.data ?? []).some((u: { id: string }) => u.id === id)) expect((await ctx.delete(`/api/teacher-unavailability/${id}`)).ok()).toBeTruthy();
  }
  await ctx.dispose();
});

async function openRecordSheet(page: Page) {
  await page.goto("/operations/absences");
  await page.getByRole("button", { name: "Record absence" }).first().click();
  await expect(page.getByRole("dialog", { name: "Record absence" })).toBeVisible();
  return page.getByRole("dialog");
}

async function fillAbsence(page: Page, t: Teacher, start: string, end: string) {
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Teacher" }).click();
  await page.getByRole("option", { name: option(t), exact: true }).click();
  await sheet.getByLabel("First day").fill(start);
  await sheet.getByLabel("Last day").fill(end);
  await sheet.getByRole("checkbox", { name: "Assign substitutes automatically" }).click();
}

test("[real] ALREADY_COVERING on the cover sheet: a stale candidate is refused and the list is refreshed", async ({ page, baseURL }) => {
  const ctx = await api(baseURL);
  absenceA = await recordAbsence(ctx, { teacherId: A.id, startDate: D, endDate: D, scope: "FULL_DAY" });
  absenceG = await recordAbsence(ctx, { teacherId: G.id, startDate: D, endDate: D, scope: "PERIODS", fromPeriod: P, toPeriod: P });
  coverA = (await coversOf(ctx, absenceA)).find((c) => c.periodNumber === P)!.id;
  coverG = (await coversOf(ctx, absenceG)).find((c) => c.periodNumber === P)!.id;
  expect(coverA && coverG).toBeTruthy();

  // The sheet for G's lesson lists free teachers; pick one (B) who is also free for A's lesson in the same period.
  await page.goto(`/operations?date=${D}&cover=${coverG}`);
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${P}`) });
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
  const aCandidates = await data<{ candidates: Array<{ id: string; tierKey: string; offered: boolean }> }>(await ctx.get(`/api/substitutions/${coverA}/candidates`), "candidates A");
  const freeForA = new Set(aCandidates.candidates.filter((c) => c.offered && c.tierKey !== "LAST_RESORT").map((c) => c.id));
  const labels = await sheet.getByRole("button", { name: /^Assign / }).allTextContents();
  const names = labels.map((l) => l.replace(/^Assign /, "").trim());
  const bName = names.find((n) => [...teachersById.values()].some((t) => t.name === n && freeForA.has(t.id) && t.id !== E.id && t.id !== C.id));
  expect(bName, "a teacher free for both lessons").toBeTruthy();
  B = [...teachersById.values()].find((t) => t.name === bName)!;

  // Behind the open sheet's back, B is given A's lesson in the same period (manual assignment).
  await data(await ctx.put(`/api/substitutions/${coverA}/assignment`, { data: { teacherId: B.id } }), "assign B to A's lesson");
  await ctx.dispose();

  await sheet.getByRole("button", { name: `Assign ${B.name}`, exact: true }).click();
  const notice = sheet.getByRole("alert");
  await expect(notice).toContainText("already assigned to cover another lesson in this period");
  await expect(notice).toContainText("The list of teachers has been refreshed.");
  await expect(sheet.getByRole("button", { name: `Assign ${B.name}`, exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible(); // still needs cover
});

test("[real] TEACHER_IS_COVERING: recording an absence for a manual substitute lists their lessons", async ({ page }) => {
  expect(B).toBeTruthy();
  const sheet = await openRecordSheet(page);
  await fillAbsence(page, B!, D, D);
  await sheet.getByRole("button", { name: "Record absence" }).click();
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText("assigned by an admin to cover 1 lesson");
  await expect(alert.getByRole("listitem")).toHaveCount(1);
  await expect(alert.getByRole("listitem")).toContainText(`${D} period ${P}`);
  await expect(alert.getByRole("listitem")).toContainText(`substitute ${B!.name}`);
  await expect(alert).not.toContainText(coverA); // the internal request id is not shown
  await expect(page.getByRole("dialog", { name: "Record absence" })).toBeVisible(); // nothing was recorded
});

test("[real] ASSIGNED_COVERS_EXIST: cancelling an absence with a manual cover lists it; after unassigning it cancels", async ({ page, baseURL }) => {
  await page.goto(`/operations/absences/${absenceA}`);
  await expect(page.getByRole("heading", { name: `${A.name}’s absence` })).toBeVisible();
  await page.getByRole("button", { name: "Cancel absence" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Cancel this absence?" });
  await dialog.getByRole("button", { name: "Cancel absence" }).click();
  const alert = dialog.getByRole("alert");
  await expect(alert).toContainText("are assigned for this absence");
  await expect(alert.getByRole("listitem")).toContainText(`${D} period ${P}`);
  await expect(alert).toContainText("Unassign or cancel these covers on the daily cover board first.");
  await dialog.getByRole("button", { name: "Keep absence" }).click();

  // Unassign through the cover sheet, then the cancellation succeeds.
  await page.goto(`/operations?date=${D}&cover=${coverA}`);
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${P}`) });
  await sheet.getByRole("button", { name: `Unassign ${B!.name}` }).click();
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();

  await page.goto(`/operations/absences/${absenceA}`);
  await page.getByRole("button", { name: "Cancel absence" }).click();
  await page.getByRole("alertdialog", { name: "Cancel this absence?" }).getByRole("button", { name: "Cancel absence" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  const ctx = await api(baseURL);
  expect((await data<{ status: string }>(await ctx.get(`/api/teacher-absences/${absenceA}`), "absence A")).status).toBe("CANCELLED");
  await ctx.dispose();
});

test("[mocked] REPLACEMENT_ALREADY_BOOKED and FOUR_CONSECUTIVE_NOT_ALLOWED messages on the cover sheet", async ({ page }) => {
  const refusals = [
    { code: "REPLACEMENT_ALREADY_BOOKED", message: "This teacher was just booked for another lesson in the same period" },
    {
      code: "FOUR_CONSECUTIVE_NOT_ALLOWED",
      message: "The school's policy (NEVER_ALLOW) does not allow a substitute to teach four or more consecutive periods; this teacher would have 4 (periods 2–5).",
    },
  ];
  let next = 0;
  await page.route(
    (url) => url.pathname === `/api/substitutions/${coverG}/assignment`,
    (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const refusal = refusals[next++ % refusals.length]!;
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ success: false, message: refusal.message, errors: { code: [refusal.code], ...(refusal.code.startsWith("FOUR") ? { periods: ["2", "3", "4", "5"] } : {}) } }),
      });
    },
  );
  await page.goto(`/operations?date=${D}&cover=${coverG}`);
  const sheet = page.getByRole("dialog", { name: new RegExp(`Period ${P}`) });
  const assign = sheet.getByRole("button", { name: /^Assign / }).first();

  await assign.click();
  await expect(sheet.getByRole("alert")).toContainText("This teacher was just booked for another lesson in the same period");
  await expect(sheet.getByRole("alert")).toContainText("The list of teachers has been refreshed.");

  await sheet.getByRole("button", { name: /^Assign / }).first().click();
  await expect(sheet.getByRole("alert")).toContainText("does not allow a substitute to teach four or more consecutive periods");
  await expect(page.getByRole("alertdialog")).toHaveCount(0); // not-allowed is never offered as a confirmation
  await expect(sheet.getByRole("heading", { name: "Choose a substitute" })).toBeVisible();
});

test("[real] ASSIGNED_COVERS_OUTSIDE: shortening a multi-day absence past a manual cover lists the lesson", async ({ page, baseURL }) => {
  const ctx = await api(baseURL);
  absenceC = await recordAbsence(ctx, { teacherId: C.id, startDate: C1, endDate: C2, scope: "FULL_DAY" });
  const day2 = (await coversOf(ctx, absenceC)).filter((c) => c.date === C2).sort((a, b) => a.periodNumber - b.periodNumber)[0];
  expect(day2, "a lesson on the second day").toBeTruthy();
  const substitute = await assignFreeCandidate(ctx, day2!.id, new Set([E.id]));
  await ctx.dispose();

  await page.goto(`/operations/absences/${absenceC}`);
  await expect(page.getByRole("heading", { name: `${C.name}’s absence` })).toBeVisible();
  await page.getByRole("button", { name: "Edit absence" }).click();
  const edit = page.getByRole("dialog", { name: "Edit absence" });
  await edit.getByLabel("Last day").fill(C1);
  await edit.getByRole("button", { name: "Save changes" }).click();
  const alert = edit.getByRole("alert");
  await expect(alert).toContainText("would fall outside the changed absence");
  await expect(alert.getByRole("listitem")).toHaveCount(1);
  await expect(alert.getByRole("listitem")).toContainText(`${C2} period ${day2!.periodNumber}`);
  await expect(alert.getByRole("listitem")).toContainText(`substitute ${teachersById.get(substitute)!.name}`);
  await expect(page.getByRole("dialog", { name: "Edit absence" })).toBeVisible(); // not saved
});

test("[real] ABSENCE_OVERLAP: the refusal links to the existing absence", async ({ page }) => {
  const sheet = await openRecordSheet(page);
  await fillAbsence(page, C, C1, C1);
  await sheet.getByRole("button", { name: "Record absence" }).click();
  const alert = sheet.getByRole("alert");
  await expect(alert).toContainText("already has an active absence that overlaps");
  const link = alert.getByRole("link", { name: "Open the existing absence" });
  await expect(link).toHaveAttribute("href", `/operations/absences/${absenceC}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/operations/absences/${absenceC}$`));
  await expect(page.getByRole("heading", { name: `${C.name}’s absence` })).toBeVisible();
});

test("[real] UNAVAILABILITY_EXISTS: the same teacher, date and period twice is refused; then cancelled", async ({ page }) => {
  async function add() {
    await page.getByRole("button", { name: "Add unavailability" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add unavailability" });
    await dialog.getByRole("combobox", { name: "Teacher" }).click();
    await page.getByRole("option", { name: option(E), exact: true }).click();
    await dialog.getByLabel("Date").fill(D);
    await dialog.getByRole("checkbox", { name: "Whole day" }).click();
    await dialog.getByLabel("Period").fill(String(EP));
    const response = page.waitForResponse((r) => r.url().includes("/api/teacher-unavailability") && r.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add unavailability" }).click();
    return { dialog, response: await response };
  }

  await page.goto("/operations/unavailability");
  const first = await add();
  expect(first.response.status()).toBe(201);
  unavailability.push((await first.response.json()).data.id);
  await expect(page.getByRole("dialog", { name: "Unavailability added" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const second = await add();
  expect(second.response.status()).toBe(409);
  await expect(second.dialog.getByRole("alert")).toContainText("already marked unavailable for this date and period");
  await expect(page.getByRole("dialog", { name: "Add unavailability" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("From", { exact: true }).fill(D);
  await page.getByLabel("To", { exact: true }).fill(D);
  const cancel = page.getByRole("button", { name: new RegExp(`Cancel unavailability for ${E.name} .*Period ${EP}$`) });
  await expect(cancel).toHaveCount(1);
  await cancel.click();
  await page.getByRole("alertdialog", { name: "Cancel this unavailability?" }).getByRole("button", { name: "Cancel unavailability" }).click();
  await expect(cancel).toHaveCount(0);
});
