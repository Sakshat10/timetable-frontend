import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seed } from "./support/seed";

/**
 * Accessibility (axe-core, WCAG 2.0/2.1 A and AA) on every major page, against the real backend.
 * Fails on serious or critical violations. The Next.js dev overlay (nextjs-portal) is excluded: it is not
 * part of the application and is absent from production builds.
 */
const current = () => seed().academicYears.current.id;
const future = () => seed().academicYears.future.id;

/** Waits until no CSS/Web animation is running, so colours are not measured mid-fade (dialogs, sheets, toasts). */
async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
}

async function scan(page: Page) {
  await settled(page);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 3).join(", ")}`);
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1").first()).toBeVisible();
}

const YEAR_PAGES: Array<[string, () => string]> = [
  ["dashboard", current],
  ["setup", future],
  ["classes", future],
  ["subjects", future],
  ["curriculum", future],
  ["teachers", future],
  ["assignments", future],
  ["schedule", future],
  ["generate", future],
  ["timetables", current],
];

for (const [page, year] of YEAR_PAGES) {
  test(`a11y: /years/:year/${page}`, async ({ page: browserPage }) => {
    await open(browserPage, `/years/${year()}/${page}`);
    expect(await scan(browserPage)).toEqual([]);
  });
}

for (const path of ["/operations", "/operations/absences", "/operations/unavailability", "/settings", "/setup/start"]) {
  test(`a11y: ${path}`, async ({ page }) => {
    await open(page, path);
    expect(await scan(page)).toEqual([]);
  });
}

test("a11y: teacher detail", async ({ page }) => {
  const teachers = await (await page.request.get("/api/teachers")).json();
  await open(page, `/years/${future()}/teachers/${teachers.data[0].id}`);
  expect(await scan(page)).toEqual([]);
});

test("a11y: published timetable (class and teacher views)", async ({ page }) => {
  const versions = await (await page.request.get(`/api/timetable-versions?academicYearId=${current()}&status=PUBLISHED`)).json();
  await open(page, `/years/${current()}/timetables/${versions.data[0].id}`);
  expect(await scan(page)).toEqual([]);
  await page.getByRole("radio", { name: "Teacher", exact: true }).click();
  await page.waitForLoadState("networkidle");
  expect(await scan(page)).toEqual([]);
});

test("a11y: open dialogs (record absence, new academic year)", async ({ page }) => {
  await open(page, "/operations/absences");
  await page.getByRole("button", { name: "Record absence" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await scan(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await open(page, "/settings");
  await page.getByRole("button", { name: "New academic year" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await scan(page)).toEqual([]);
});

test("a11y: signed-out pages (login, signup)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await scan(page)).toEqual([]);
  }
  await context.close();
});

test("keyboard: the first Tab stop is a skip link that moves focus to the main content", async ({ page }) => {
  await open(page, `/years/${current()}/dashboard`);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("keyboard: the year switcher's accessible name contains its visible text", async ({ page }) => {
  await open(page, `/years/${current()}/dashboard`);
  const name = `Academic year ${seed().academicYears.current.name}`;
  await expect(page.getByRole("button", { name: new RegExp(`^${name}.*change academic year$`) })).toBeVisible();
});
