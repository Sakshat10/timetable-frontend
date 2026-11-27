import { expect, request, test, type BrowserContext, type Page } from "@playwright/test";
import { expireSession, sessionRow } from "./support/db";
import { seed } from "./support/seed";

/**
 * AUTH-PROXY-TEST-PLAN T1, T2, T4, T7 through the real same-origin forwarding layer (dev-like environment E1).
 * Uses its OWN sessions (never the shared e2e session). The backend allows 5 logins / 15 min / address:
 * this file performs 2 (one invalid, one valid) plus 1 for the cross-school check.
 */
test.describe.configure({ mode: "serial" });

const SEED_YEAR = () => seed().academicYears.current.id;

async function login(page: Page, next?: string) {
  const { schoolId, email, password } = seed().login;
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("School ID").fill(schoolId);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("T1.3 malformed School ID is caught before any request", async ({ page }) => {
  let loginCalls = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/admin/login")) loginCalls++;
  });
  await page.goto("/login");
  await page.getByLabel("School ID").fill("not-a-uuid");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/A School ID looks like/)).toBeVisible();
  expect(loginCalls).toBe(0);
});

test("T1.2 invalid credentials: generic message, no cookie", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("School ID").fill(seed().login.schoolId);
  await page.getByLabel("Email").fill(seed().login.email);
  await page.getByLabel("Password").fill("Wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "School ID, email or password is not correct" })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === "session_token")).toBeUndefined();
  // The login page never offers password reset or school-code login (CAPABILITY-BOUNDARIES X12, X13).
  await expect(page.getByText(/forgot password|reset password|school code/i)).toHaveCount(0);
});

test("T1.5 a `next` that browsers turn into another host is ignored (tab, newline, backslash)", async ({ page }) => {
  // The login answer is simulated (no session, no rate-limit use): only the client-side redirect is under test.
  const external: string[] = [];
  await page.route(
    (url) => url.hostname === "evil.example",
    (route) => {
      external.push(route.request().url());
      return route.abort();
    },
  );
  await page.route(
    (url) => url.pathname === "/api/admin/login",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, message: "Login successful", data: { id: "00000000-0000-4000-8000-000000000001", schoolId: "00000000-0000-4000-8000-000000000002", name: "A", email: "a@example.com" } }),
      }),
  );
  // The form pre-fills the last School ID after hydration; start empty and let hydration finish before typing.
  await page.addInitScript(() => localStorage.removeItem("tt.lastSchoolId"));
  for (const next of ["/\t/evil.example/steal", "/\n/evil.example/steal", "/\\evil.example/steal"]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`, { waitUntil: "networkidle" });
    await page.getByLabel("School ID").fill("00000000-0000-4000-8000-000000000002");
    await page.getByLabel("Email").fill("a@example.com");
    await page.getByLabel("Password").fill("x");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.pathname !== "/login" || url.hostname === "evil.example");
    expect(new URL(page.url()).hostname).toBe("localhost");
  }
  expect(external).toEqual([]);
});

test.describe("with a real session", () => {
  let context: BrowserContext;
  let page: Page;
  let token = "";

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // Open-redirect guard: an external `next` is ignored.
    await login(page, "//evil.example/steal");
    await page.waitForURL(/\/years\/[0-9a-f-]+\/dashboard/);
    token = (await context.cookies()).find((c) => c.name === "session_token")?.value ?? "";
  });
  test.afterAll(async () => {
    await context.close();
  });

  test("T1.1/T2.1/T2.3 login sets an HttpOnly first-party cookie and lands on the dashboard", async () => {
    expect(new URL(page.url()).host).toBe("localhost:3100");
    const cookie = (await context.cookies()).find((c) => c.name === "session_token");
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax"); // E1: NODE_ENV=test backend; production is Strict + Secure (E2)
    expect(cookie!.path).toBe("/");
    expect(cookie!.domain).toBe("localhost");
    const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("T2.4 the session persists in a new browser context", async ({ browser }) => {
    const state = await context.storageState();
    const other = await browser.newContext({ storageState: state });
    const otherPage = await other.newPage();
    await otherPage.goto(`/years/${SEED_YEAR()}/dashboard`);
    await expect(otherPage.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await other.close();
  });

  test("T3.1 client reads are same-origin with no CORS preflight", async () => {
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) requests.push(`${r.method()} ${new URL(r.url()).host}`);
    });
    await page.goto(`/years/${SEED_YEAR()}/setup`);
    await expect(page.getByRole("heading", { name: "Setup guide" })).toBeVisible();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.endsWith("localhost:3100"))).toBe(true);
    expect(requests.some((r) => r.startsWith("OPTIONS"))).toBe(false);
  });

  test("T4.1 the session expiry is absolute (no sliding renewal)", async () => {
    const before = sessionRow(token);
    expect(before).not.toBeNull();
    for (let i = 0; i < 3; i++) await page.request.get("/api/admin/me");
    const after = sessionRow(token);
    expect(after!.expiresAt).toBe(before!.expiresAt);
  });

  test("T7.6 a 500 with internals shows only the generic message", async () => {
    await page.route(
      (url) => url.pathname === "/api/subjects",
      (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ statusCode: 500, code: "P1001", message: "Invalid `this.db.adminSession.findUnique()` invocation in /src/modules/admin/admin.service.ts:132:48" }),
        }),
    );
    await page.goto(`/years/${SEED_YEAR()}/setup`);
    await expect(page.getByText(/admin\.service|findUnique|P1001/)).toHaveCount(0);
    await page.unroute((url) => url.pathname === "/api/subjects");
  });

  test("T4.2/T4.6 an expired session redirects once to login with one notice", async () => {
    await page.goto(`/years/${SEED_YEAR()}/dashboard`);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    expireSession(token);
    // Several parallel client queries now get 401: exactly one redirect and one notice.
    // Navigate somewhere whose data is not cached, so the client actually calls the API and gets 401s. A background
    // refetch may hit the 401 first and redirect on its own (the behaviour under test), detaching the link mid-click,
    // so the click is best-effort and the redirect is what is asserted.
    await Promise.all([
      page.waitForURL(/\/login\?reason=expired/),
      page.getByRole("link", { name: "Settings" }).first().click({ timeout: 5_000 }).catch(() => undefined),
    ]);
    // One notice: the login page's expired-session banner (the redirect is a full-page navigation).
    await expect(page.getByText(/Your session ended/)).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("next")).toMatch(/^\/years\//);
    expect(sessionRow(token)).toBeNull(); // the backend deleted the expired session
  });
});

test("T1.4 logout clears the cookie and the server session (replaying the token fails)", async ({ browser, baseURL }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  await page.waitForURL(/\/years\/[0-9a-f-]+\/dashboard/);
  const token = (await context.cookies()).find((c) => c.name === "session_token")!.value;
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  expect((await context.cookies()).find((c) => c.name === "session_token")).toBeUndefined();
  const replay = await request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `session_token=${token}` } });
  expect((await replay.get("/api/admin/me")).status()).toBe(401);
  await replay.dispose();
  await context.close();
});

test("T4.4 no cookie: protected pages redirect to login with next", async ({ page }) => {
  await page.goto(`/years/${SEED_YEAR()}/classes`);
  await page.waitForURL(/\/login\?next=/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toBe(`/years/${SEED_YEAR()}/classes`);
});

test("T4.5 an invalid cookie never renders protected content", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addCookies([{ name: "session_token", value: "f".repeat(64), domain: "localhost", path: "/" }]);
  const page = await context.newPage();
  await page.goto(`/years/${SEED_YEAR()}/dashboard`);
  await page.waitForURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toHaveCount(0);
  await context.close();
});

test("T7.1–T7.3 unauthorised API answers through the proxy", async ({ baseURL }) => {
  const anon = await request.newContext({ baseURL });
  const none = await anon.get("/api/teachers");
  expect(none.status()).toBe(401);
  expect(await none.json()).toMatchObject({ success: false, message: "Authentication required" });
  const bad = await request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `session_token=${"0".repeat(64)}` } });
  const invalid = await bad.get("/api/teachers");
  expect(invalid.status()).toBe(401);
  expect(await invalid.json()).toMatchObject({ message: "Invalid or expired session" });
  // Documented backend behaviour: Ajv validation runs before authentication (400 `{ message }`).
  const malformed = await anon.post("/api/grades", { data: { academicYearId: "x", name: 1, displayOrder: "y" } });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).not.toHaveProperty("success");
  await anon.dispose();
  await bad.dispose();
});

test("T7.4 another school's records are refused and shown as not found", async ({ browser, baseURL }) => {
  const api = await request.newContext({ baseURL });
  const code = `QA-X${Date.now().toString(36).toUpperCase()}`;
  const created = await api.post("/api/schools", { data: { name: "QA Isolation School", code, schoolType: "CUSTOM" } });
  test.skip(created.status() === 429, "School creation is limited to 1 per 24 h per address; restart the e2e backend (e2e.sh restart) to run this check.");
  expect(created.status()).toBe(201);
  const school = (await created.json()).data as { id: string; setupToken: string };
  const email = `qa-iso-${Date.now()}@example.invalid`;
  const password = "QaIsolation1";
  expect((await api.post("/api/admin/register", { data: { schoolId: school.id, setupToken: school.setupToken, name: "QA Isolation", email, password } })).status()).toBe(201);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("School ID").fill(school.id);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/setup\/start/);
  const cross = await page.request.get(`/api/academic-years/${SEED_YEAR()}`);
  expect(cross.status()).toBe(403);
  await page.goto(`/years/${SEED_YEAR()}/dashboard`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await context.close();
  await api.dispose();
});
