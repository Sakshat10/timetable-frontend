import { seed } from "./support/seed";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Classes, Subjects and Curriculum against the real disposable backend (shared session).
 *
 * DATA OWNERSHIP: other specs share this database. Writes go ONLY to the future DRAFT year 2027-28 and only to
 * records created here, named with the "QA-S" prefix (subject codes start with "QAS"). The ACTIVE year 2026-27 is
 * only read. Everything created is removed at the end (UI first, then an API sweep as a safety net).
 */
const FUTURE = seed().academicYears.future.id;
const ACTIVE = seed().academicYears.current.id;
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const GRADE = `QA-S Grade A ${RUN}`;
const GRADE_EDITED = `QA-S Grade A1 ${RUN}`;
const BULK_GRADE = `QA-S Bulk ${RUN}`;
const SUBJECT = { name: `QA-S Subject ${RUN}`, code: `QAS${RUN}` };
const ORDER = 500 + (Date.now() % 400);

test.describe.configure({ mode: "serial" });

const gradeCard = (page: Page, name: string) => page.locator("li").filter({ has: page.getByRole("heading", { name, exact: true }) });

async function openFuture(page: Page, module: "classes" | "subjects" | "curriculum") {
  await page.goto(`/years/${FUTURE}/${module}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test.describe("setup modules", () => {
  test("the ACTIVE year is readable but setup is locked", async ({ page }) => {
    await page.goto(`/years/${ACTIVE}/classes`);
    await expect(page.getByText(/is active\. Setup is locked/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Add grade" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add several grades" })).toBeDisabled();
    await expect(page.locator("li h2").first()).toBeVisible();

    await page.goto(`/years/${ACTIVE}/curriculum`);
    await expect(page.getByText(/is active\. Setup is locked/)).toBeVisible();
    const edit = page.getByRole("button", { name: /^Edit curriculum of / }).first();
    await expect(edit).toBeVisible();
    await expect(edit).toBeDisabled();
  });

  test("create, edit and validate a grade (server conflict mapped to the field)", async ({ page }) => {
    await openFuture(page, "classes");
    await page.getByRole("button", { name: "Add grade" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Grade name").fill(GRADE);
    await dialog.getByLabel("Display order").fill(String(ORDER));
    await dialog.getByRole("button", { name: "Add grade" }).click();
    await expect(dialog).toBeHidden();
    await expect(gradeCard(page, GRADE)).toBeVisible();

    // Duplicate name: the backend's 409 is shown under the name field, and nothing is created.
    await page.getByRole("button", { name: "Add grade" }).click();
    await dialog.getByLabel("Grade name").fill(GRADE);
    await dialog.getByLabel("Display order").fill(String(ORDER + 1));
    await dialog.getByRole("button", { name: "Add grade" }).click();
    await expect(dialog.getByText(`Grade "${GRADE}" already exists in this academic year`)).toBeVisible();
    await expect(dialog.getByLabel("Grade name")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Edit the name.
    await page.getByRole("button", { name: `Actions for ${GRADE}` }).click();
    await page.getByRole("menuitem", { name: "Edit grade" }).click();
    await dialog.getByLabel("Grade name").fill(GRADE_EDITED);
    await dialog.getByRole("button", { name: "Save grade" }).click();
    await expect(dialog).toBeHidden();
    await expect(gradeCard(page, GRADE_EDITED)).toBeVisible();
  });

  test("add, edit and delete sections; a blocked grade delete lists what is in the way", async ({ page }) => {
    await openFuture(page, "classes");
    const card = gradeCard(page, GRADE_EDITED);
    const dialog = page.getByRole("dialog");
    for (const code of ["A", "B"]) {
      await card.getByRole("button", { name: "Add section" }).click();
      await dialog.getByLabel("Section name").fill(`Section ${code}`);
      await dialog.getByLabel("Section code").fill(code);
      await dialog.getByRole("button", { name: "Add section" }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(card.getByText("Section A", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: `Edit section ${GRADE_EDITED} Section B` }).click();
    await dialog.getByLabel("Section name").fill("Section Bee");
    await dialog.getByRole("button", { name: "Save section" }).click();
    await expect(card.getByText("Section Bee", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: `Delete section ${GRADE_EDITED} Section Bee` }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete section" }).click();
    await expect(confirm).toBeHidden();
    await expect(card.getByText("Section Bee", { exact: true })).toHaveCount(0);

    // The grade still has a section: the backend refuses and the dialog shows errors.blockedBy.
    await page.getByRole("button", { name: `Actions for ${GRADE_EDITED}` }).click();
    await page.getByRole("menuitem", { name: "Delete grade" }).click();
    await confirm.getByRole("button", { name: "Delete grade" }).click();
    await expect(confirm.getByText("This can’t be deleted yet because it is still in use:")).toBeVisible();
    await expect(confirm.getByRole("listitem").first()).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(gradeCard(page, GRADE_EDITED)).toBeVisible();
  });

  test("add several grades with streams and sections in one step", async ({ page }) => {
    await openFuture(page, "classes");
    await page.getByRole("button", { name: "Add several grades" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Grade 1 name").fill(BULK_GRADE);
    await dialog.getByLabel("Grade 1 display order").fill(String(ORDER + 2));

    await dialog.getByRole("switch").click();
    await dialog.getByLabel("Grade 1 stream 1 name").fill("Science");
    await dialog.getByLabel("Grade 1 stream 1 code").fill("SCI");
    await dialog.getByRole("button", { name: "Add section" }).click();
    await expect(dialog.getByLabel("Grade 1 section 1 name")).toHaveValue("Section A");
    await dialog.getByRole("button", { name: "Create 1 grade" }).click();
    await expect(dialog).toBeHidden();

    const card = gradeCard(page, BULK_GRADE);
    await expect(card).toBeVisible();
    await expect(card.getByText("Uses streams")).toBeVisible();
    await expect(card.getByText("Science")).toBeVisible();
    await expect(card.getByText("Section A", { exact: true })).toBeVisible();
  });

  test("subjects: create, duplicate code error, bulk with a row-keyed server error", async ({ page }) => {
    await openFuture(page, "subjects");
    await expect(page.getByText(/school-wide/)).toBeVisible();
    const dialog = page.getByRole("dialog");

    await page.getByRole("button", { name: "Add subject" }).click();
    await dialog.getByLabel("Subject name").fill(SUBJECT.name);
    await dialog.getByLabel("Code").fill(SUBJECT.code.toLowerCase());
    await expect(dialog.getByText(`Will be saved as ${SUBJECT.code}`)).toBeVisible();
    await dialog.getByRole("button", { name: "Add subject" }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel("Search subjects").fill(SUBJECT.code);
    await expect(page.getByRole("cell", { name: SUBJECT.code, exact: true })).toBeVisible();

    // Duplicate code (single): the 409 lands on the Code field.
    await page.getByRole("button", { name: "Add subject" }).click();
    await dialog.getByLabel("Subject name").fill(`${SUBJECT.name} again`);
    await dialog.getByLabel("Code").fill(SUBJECT.code);
    await dialog.getByRole("button", { name: "Add subject" }).click();
    await expect(dialog.getByText(`Subject with code "${SUBJECT.code}" already exists in this school`)).toBeVisible();
    await expect(dialog.getByLabel("Code")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Bulk: row 3 repeats an existing code → the backend's subjects.2.code error is shown on row 3; nothing is added.
    await page.getByRole("button", { name: "Add several" }).click();
    await dialog.getByLabel("Row 1 subject name").fill(`QA-S Bulk B ${RUN}`);
    await dialog.getByLabel("Row 1 code").fill(`${SUBJECT.code}B`);
    await dialog.getByLabel("Row 2 subject name").fill(`QA-S Bulk C ${RUN}`);
    await dialog.getByLabel("Row 2 code").fill(`${SUBJECT.code}C`);
    await dialog.getByLabel("Row 3 subject name").fill(`QA-S Bulk D ${RUN}`);
    await dialog.getByLabel("Row 3 code").fill(SUBJECT.code);
    await dialog.getByRole("button", { name: "Add 3 subjects" }).click();
    await expect(dialog.getByText("Nothing was added. Fix the highlighted rows and try again.")).toBeVisible();
    await expect(dialog.getByLabel("Row 3 code")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Row 1 code")).not.toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Remove row 3" }).click();
    await dialog.getByRole("button", { name: "Add 2 subjects" }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel("Search subjects").fill(`${SUBJECT.code}`);
    await expect(page.getByRole("cell", { name: `${SUBJECT.code}C`, exact: true })).toBeVisible();

    // Delete one of the bulk subjects (not used anywhere).
    await page.getByRole("button", { name: `Actions for QA-S Bulk C ${RUN}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete subject" }).click();
    await expect(page.getByRole("cell", { name: `${SUBJECT.code}C`, exact: true })).toHaveCount(0);
  });

  test("subjects: codes are filled in from the names and a typed code is kept (nothing is saved)", async ({ page }) => {
    await openFuture(page, "subjects");
    const existing = ((await (await page.request.get("/api/subjects")).json()).data as Array<{ code: string }>).map((s) => s.code);
    const dialog = page.getByRole("dialog");

    // Add several: each row's code follows its name; clashes with existing subjects or other rows get a number.
    await page.getByRole("button", { name: "Add several" }).click();
    await dialog.getByLabel("Row 1 subject name").fill("Zygology");
    await expect(dialog.getByLabel("Row 1 code")).toHaveValue(existing.includes("ZYG") ? /^ZYG\d+$/ : "ZYG");
    await dialog.getByLabel("Row 2 subject name").fill("Zygology extra");
    await expect(dialog.getByLabel("Row 2 code")).toHaveValue(/^ZE\d*$/);
    await dialog.getByLabel("Row 3 subject name").fill("Zygology");
    const first = await dialog.getByLabel("Row 1 code").inputValue();
    await expect(dialog.getByLabel("Row 3 code")).not.toHaveValue(first); // no duplicate within the list
    // A typed code is kept when the name changes afterwards.
    await dialog.getByLabel("Row 1 code").fill("MYCODE");
    await dialog.getByLabel("Row 1 subject name").fill("Something else");
    await expect(dialog.getByLabel("Row 1 code")).toHaveValue("MYCODE");
    // Clearing the code hands it back to the name.
    await dialog.getByLabel("Row 1 code").fill("");
    await dialog.getByLabel("Row 1 subject name").fill("Quokka studies");
    await expect(dialog.getByLabel("Row 1 code")).toHaveValue(/^QS\d*$/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Add subject: the same suggestion; nothing is submitted.
    await page.getByRole("button", { name: "Add subject" }).first().click();
    await dialog.getByLabel("Subject name").fill("Quokka studies");
    await expect(dialog.getByLabel("Code")).toHaveValue(/^QS\d*$/);
    await dialog.getByLabel("Code").fill("QKS");
    await dialog.getByLabel("Subject name").fill("Quokka studies 2");
    await expect(dialog.getByLabel("Code")).toHaveValue("QKS");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("curriculum: review the dry-run plan, then apply", async ({ page }) => {
    await openFuture(page, "curriculum");
    await expect(page.getByText("Curriculum is not teacher assignment.")).toBeVisible();
    await page.getByRole("button", { name: `Edit curriculum of ${GRADE_EDITED}` }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("combobox", { name: "Row 1 subject" }).click();
    await page.getByRole("option", { name: `${SUBJECT.name} (${SUBJECT.code})` }).click();

    // Client validation first (strict 1..40).
    await sheet.getByLabel(`${SUBJECT.name}: periods per week`).fill("41");
    await sheet.getByRole("button", { name: "Review changes" }).click();
    await expect(sheet.getByText("Use a whole number from 1 to 40")).toBeVisible();

    await sheet.getByLabel(`${SUBJECT.name}: periods per week`).fill("4");
    await sheet.getByRole("button", { name: "Review changes" }).click();
    await expect(sheet.getByRole("heading", { name: `Review changes: ${GRADE_EDITED}` })).toBeVisible();
    await expect(sheet.getByText("This will add 1 subject.")).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Added subjects" }).getByText(SUBJECT.name)).toBeVisible();

    // Nothing was written by the review.
    await sheet.getByRole("button", { name: "Back to editing" }).click();
    await sheet.getByRole("button", { name: "Review changes" }).click();
    await sheet.getByRole("button", { name: "Apply changes" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(`Curriculum of ${GRADE_EDITED} saved`)).toBeVisible();
    await expect(page.getByRole("table", { name: `Curriculum of ${GRADE_EDITED}` }).getByText(SUBJECT.name)).toBeVisible();
  });

  test("a subject used in a curriculum cannot be deleted (blockedBy shown)", async ({ page }) => {
    await openFuture(page, "subjects");
    await page.getByLabel("Search subjects").fill(SUBJECT.code);
    await expect(page.getByRole("row").filter({ has: page.getByRole("cell", { name: SUBJECT.code, exact: true }) }).getByText("1 grade")).toBeVisible();
    await page.getByRole("button", { name: SUBJECT.name, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("list", { name: `Where ${SUBJECT.name} is taught in 2027-28` })).toContainText(GRADE_EDITED);
    await sheet.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Delete subject" }).click();
    await expect(confirm.getByText("This can’t be deleted yet because it is still in use:")).toBeVisible();
    await confirm.getByRole("button", { name: "Cancel" }).click();
  });

  test("curriculum: copy from another grade (reviewed first)", async ({ page }) => {
    await openFuture(page, "curriculum");
    const target = `${BULK_GRADE} · Science`;
    await page.getByRole("button", { name: `Copy from another grade into ${target}` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Copy from" }).click();
    await page.getByRole("option").first().click();
    await dialog.getByRole("button", { name: "Review copy" }).click();
    const added = dialog.getByRole("region", { name: "Subjects that will be added" });
    await expect(added).toBeVisible();
    const count = await added.getByRole("listitem").count();
    expect(count).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: /^Copy \d+ subjects?$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`into ${target}`)).toBeVisible();
    await expect(page.getByRole("table", { name: `Curriculum of ${target}` }).getByRole("row")).toHaveCount(count + 1);
  });

  test("empty and error states", async ({ page }) => {
    await page.route((url) => url.pathname === "/api/subjects", (route) =>
      route.request().method() === "GET" ? route.fulfill({ json: { success: true, message: "ok", data: [] } }) : route.fallback(),
    );
    await openFuture(page, "subjects");
    await expect(page.getByText("No subjects yet")).toBeVisible();
    await page.unroute((url) => url.pathname === "/api/subjects");

    await page.route((url) => url.pathname === "/api/curriculum", (route) =>
      route.fulfill({ status: 500, json: { success: false, message: "PrismaClientKnownRequestError at /srv/app/internal.ts" } }),
    );
    await openFuture(page, "classes");
    await expect(page.getByText("Couldn’t load classes")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("The server could not complete the request. Please try again in a moment.")).toBeVisible();
    await expect(page.getByText(/Prisma/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("clean up through the UI", async ({ page }) => {
    // Clear the curriculum (an empty list removes every subject: reviewed first).
    await openFuture(page, "curriculum");
    await page.getByRole("button", { name: `Edit curriculum of ${GRADE_EDITED}` }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: `Remove ${SUBJECT.name}` }).click();
    await sheet.getByRole("button", { name: "Review changes" }).click();
    await expect(sheet.getByRole("region", { name: "Removed subjects" }).getByText(SUBJECT.name)).toBeVisible();
    await sheet.getByRole("button", { name: "Apply changes" }).click();
    await expect(sheet).toBeHidden();

    await openFuture(page, "classes");
    const card = gradeCard(page, GRADE_EDITED);
    const confirm = page.getByRole("alertdialog");
    await card.getByRole("button", { name: `Delete section ${GRADE_EDITED} Section A` }).click();
    await confirm.getByRole("button", { name: "Delete section" }).click();
    await expect(confirm).toBeHidden();
    await page.getByRole("button", { name: `Actions for ${GRADE_EDITED}` }).click();
    await page.getByRole("menuitem", { name: "Delete grade" }).click();
    await confirm.getByRole("button", { name: "Delete grade" }).click();
    await expect(confirm).toBeHidden();
    await expect(gradeCard(page, GRADE_EDITED)).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: "e2e/.auth/admin.json", baseURL: "http://localhost:3100" });
    try {
      await sweep(context.request);
    } finally {
      await context.close();
    }
  });
});

/** Removes every "QA-S" grade of the future year created by this run and its "QAS" subjects. */
async function sweep(request: APIRequestContext) {
  const overview = (await (await request.get(`/api/curriculum?academicYearId=${FUTURE}`)).json()).data as {
    grades: Array<{ id: string; name: string; streams: Array<{ id: string }>; curricula: Array<{ streamId: string | null; requirements: unknown[]; sections: Array<{ id: string }> }> }>;
  };
  for (const grade of overview.grades.filter((g) => g.name.startsWith("QA-S") && g.name.endsWith(RUN))) {
    for (const group of grade.curricula) {
      if (group.requirements.length > 0) {
        await request.put(`/api/curriculum/grades/${grade.id}`, { data: { ...(group.streamId ? { streamId: group.streamId } : {}), requirements: [] } });
      }
      for (const section of group.sections) await request.delete(`/api/sections/${section.id}`);
    }
    for (const stream of grade.streams) await request.delete(`/api/streams/${stream.id}`);
    await request.delete(`/api/grades/${grade.id}`);
  }
  const subjects = (await (await request.get("/api/subjects")).json()).data as Array<{ id: string; code: string }>;
  for (const subject of subjects.filter((s) => s.code.startsWith(`QAS${RUN}`))) await request.delete(`/api/subjects/${subject.id}`);
}
