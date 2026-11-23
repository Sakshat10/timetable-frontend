import { expect, request, test as setup } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { seed } from "./support/seed";

const STATE = "e2e/.auth/admin.json";

/**
 * One real login through the same-origin forwarding layer; the session is reused by every "app" spec.
 * The backend allows 5 logins per 15 minutes per address, so a still-valid saved session is reused instead
 * of logging in again. Specs must never sign out of this shared session.
 */
setup("sign in as the seeded admin", async ({ page, baseURL }) => {
  mkdirSync("e2e/.auth", { recursive: true });
  if (existsSync(STATE)) {
    const context = await request.newContext({ baseURL, storageState: STATE });
    const me = await context.get("/api/admin/me");
    await context.dispose();
    if (me.ok()) return;
  }
  const { schoolId, email, password } = seed().login;
  await page.goto("/login");
  await page.getByLabel("School ID").fill(schoolId);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/years\/[0-9a-f-]+\/dashboard/, { timeout: 60_000 });
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "session_token")?.httpOnly).toBe(true);
  await page.context().storageState({ path: STATE });
});
