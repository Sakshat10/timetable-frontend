import { expect, test } from "@playwright/test";
import { seed } from "./support/seed";

/** Mobile (Pixel 7) checks: every page fits the viewport without page-level horizontal scrolling. */
const yearId = () => seed().academicYears.current.id;
const PAGES = () => [
  `/years/${yearId()}/dashboard`,
  `/years/${yearId()}/setup`,
  `/years/${yearId()}/classes`,
  `/years/${yearId()}/subjects`,
  `/years/${yearId()}/curriculum`,
  `/years/${yearId()}/teachers`,
  `/years/${yearId()}/assignments`,
  `/years/${yearId()}/schedule`,
  `/years/${yearId()}/generate`,
  `/years/${yearId()}/timetables`,
  "/operations",
  "/operations/absences",
  "/operations/unavailability",
  "/settings",
];

for (const path of PAGES()) {
  test(`fits a phone screen: ${path.replace(/[0-9a-f-]{36}/, ":year")}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator("h1").first()).toBeVisible();
  });
}

test("the navigation opens as a drawer on phones", async ({ page }) => {
  await page.goto(`/years/${yearId()}/dashboard`);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const classes = page.getByRole("link", { name: "Classes" });
  await expect(classes).toBeVisible();
  await classes.click();
  await page.waitForURL(/\/classes$/);
  await expect(page.getByRole("link", { name: "Classes" })).toBeHidden();
});
