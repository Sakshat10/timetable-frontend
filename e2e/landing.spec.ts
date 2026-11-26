import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser } from "@playwright/test";
import { seed } from "./support/seed";

/**
 * [real] The public landing page at "/" and the light-only theme. Signed-out checks use fresh browser contexts
 * (no session); the signed-in redirect uses the shared session of the "app" project.
 */
async function signedOut(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  // An explicit empty storage state: in the "app" project, new contexts would otherwise inherit the shared session.
  const context = await browser.newContext({ baseURL: "http://localhost:3100", storageState: { cookies: [], origins: [] }, ...options });
  return { context, page: await context.newPage() };
}

test("[real] signed-out visitors see the landing page with working calls to action", async ({ browser }) => {
  const { context, page } = await signedOut(browser);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create smarter school timetables. Without the chaos.");

  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Features", "How it works", "Benefits"]) await expect(nav.getByRole("link", { name })).toBeVisible();
  for (const [id, title] of [
    ["features", "Everything a timetable needs, in one place"],
    ["how-it-works", "From a blank year to a running school"],
    ["benefits", "Less firefighting, more confidence"],
  ]) {
    await expect(page.locator(`#${id}`).getByRole("heading", { level: 2 })).toHaveText(title);
  }
  await expect(page.locator("#features li")).toHaveCount(6);
  await expect(page.locator("#how-it-works ol > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Make school timetable management simpler." })).toBeVisible();

  // No invented metrics, testimonials, prices or contact details.
  const text = (await page.locator("body").innerText()).toLowerCase();
  expect(text).not.toMatch(/\d+\s*%|\d+[,.]?\d*\s*\+|testimonial|pricing|per month|\$\d|trusted by|customers/);

  await nav.getByRole("link", { name: "Get started" }).click();
  await page.waitForURL(/\/signup$/);
  await page.goto("/");
  await nav.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await context.close();
});

test("[real] signed-in administrators are redirected from / to the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/years\/[0-9a-f-]{36}\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("[real] a stale session cookie shows the landing page, not an error", async ({ browser }) => {
  const { context, page } = await signedOut(browser);
  await context.addCookies([{ name: "session_token", value: "not-a-real-session", domain: "localhost", path: "/" }]);
  await page.goto("/");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Create smarter school timetables");
  // Protected pages still go to sign-in.
  await page.goto(`/years/${seed().academicYears.current.id}/dashboard`);
  await page.waitForURL(/\/login/);
  await context.close();
});

test("[real] the landing navigation collapses into a menu on phones", async ({ browser }) => {
  const { context, page } = await signedOut(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Features" })).toBeHidden();
  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator("#landing-mobile-menu");
  await expect(menu.getByRole("link", { name: "How it works" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await toggle.click();
  await menu.getByRole("link", { name: "Benefits" }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await context.close();
});

test("[real] the landing page has no serious accessibility violations and no CSP violations", async ({ browser }) => {
  const { context, page } = await signedOut(browser);
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(e.violatedDirective));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude("nextjs-portal").analyze();
  const serious = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  await context.close();
});

test("[real] the app stays light when the operating system prefers dark mode", async ({ browser }) => {
  // Computed colours come back in oklch(); paint them on a canvas to read sRGB, then compare relative brightness.
  const brightness = (page: import("@playwright/test").Page, selector: string) =>
    page.evaluate((sel) => {
      const element = sel === "body" ? document.body : document.querySelector(sel)!.closest("main")!;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = getComputedStyle(element).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
    }, selector);
  const { context, page } = await signedOut(browser, { colorScheme: "dark" });
  for (const path of ["/", "/login"]) {
    await page.goto(path);
    expect(await brightness(page, "body")).toBeGreaterThan(0.9);
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  }
  await context.close();

  const signedIn = await browser.newContext({ baseURL: "http://localhost:3100", colorScheme: "dark", storageState: "e2e/.auth/admin.json" });
  const app = await signedIn.newPage();
  await app.goto(`/years/${seed().academicYears.current.id}/dashboard`);
  expect(await brightness(app, "#main")).toBeGreaterThan(0.9);
  // The account menu no longer offers an appearance (theme) choice.
  await app.getByRole("button", { name: /^Account menu/ }).click();
  await expect(app.getByRole("menuitem", { name: /Appearance|Dark|Theme/ })).toHaveCount(0);
  await signedIn.close();
});
