import { expect, test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seed } from "./support/seed";

/** One real login through the same-origin forwarding layer; the session is reused by every "app" spec. */
setup("sign in as the seeded admin", async ({ page }) => {
  const { schoolId, email, password } = seed().login;
  mkdirSync("e2e/.auth", { recursive: true });
  await page.goto("/login");
  await page.getByLabel("School ID").fill(schoolId);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/years\/[0-9a-f-]+\/dashboard/, { timeout: 60_000 });
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "session_token")?.httpOnly).toBe(true);
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
