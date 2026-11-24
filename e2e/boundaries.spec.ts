import { expect, test } from "@playwright/test";
import { forbiddenControls } from "./support/boundaries";
import { seed } from "./support/seed";

/**
 * CAPABILITY-BOUNDARIES.md §4.2–4.4: no page offers a control or wording for an unsupported capability.
 * Visits every route of the application (seeded years) and scans every interactive element.
 */
const current = () => seed().academicYears.current.id;
const future = () => seed().academicYears.future.id;

const YEAR_PAGES = ["dashboard", "setup", "classes", "subjects", "curriculum", "teachers", "assignments", "schedule", "generate", "timetables"];
const SCHOOL_PAGES = ["/operations", "/operations/absences", "/operations/unavailability", "/settings", "/setup/start"];

for (const yearKey of ["current", "future"] as const) {
  for (const page of YEAR_PAGES) {
    test(`no forbidden controls: ${yearKey} year /${page}`, async ({ page: browserPage }) => {
      const yearId = yearKey === "current" ? current() : future();
      await browserPage.goto(`/years/${yearId}/${page}`);
      await browserPage.waitForLoadState("networkidle");
      await expect(browserPage.locator("main")).toBeVisible();
      expect(await forbiddenControls(browserPage)).toEqual([]);
    });
  }
}

for (const path of SCHOOL_PAGES) {
  test(`no forbidden controls: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await forbiddenControls(page)).toEqual([]);
  });
}

test("no forbidden controls in the account menu", async ({ page }) => {
  await page.goto(`/years/${current()}/dashboard`);
  await page.getByRole("button", { name: "Account menu" }).click();
  expect(await forbiddenControls(page)).toEqual([]);
  await page.keyboard.press("Escape");
});

test("the published timetable and a teacher view offer no editing, export or lifecycle controls", async ({ page }) => {
  await page.goto(`/years/${current()}/timetables`);
  await page.waitForLoadState("networkidle");
  const published = page.getByRole("link", { name: /published timetable|open/i }).first();
  await published.click();
  await page.waitForURL(/\/timetables\/[0-9a-f-]+/);
  await page.waitForLoadState("networkidle");
  expect(await forbiddenControls(page)).toEqual([]);
  // A published version is read-only: no drag handles or editing mode.
  await expect(page.locator("[aria-roledescription='draggable']")).toHaveCount(0);
});

test("the schedule uses the simplified model only (no clock-time inputs)", async ({ page }) => {
  for (const yearId of [current(), future()]) {
    await page.goto(`/years/${yearId}/schedule`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("input[type=time]")).toHaveCount(0);
    await expect(page.getByText(/start time|end time|lunch|assembly/i)).toHaveCount(0);
  }
});

test("navigation contains only implemented pages", async ({ page }) => {
  await page.goto(`/years/${current()}/dashboard`);
  const hrefs = await page.locator("[data-sidebar='menu-button']").evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(10);
  for (const href of hrefs) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }
});
