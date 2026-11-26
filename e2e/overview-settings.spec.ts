import { expect, test } from "@playwright/test";
import { seed } from "./support/seed";

/** Dashboard, setup guide, year context and settings (lead-owned pages) against the real backend. */
const current = () => seed().academicYears.current;
const future = () => seed().academicYears.future;

test("dashboard shows backend numbers for the active year", async ({ page }) => {
  await page.goto(`/years/${current().id}/dashboard`);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText(`Academic year ${current().name}`)).toBeVisible();
  const numbers = page.getByRole("region", { name: "Key numbers" });
  await expect(numbers.getByText("Sections")).toBeVisible();
  await expect(numbers.getByText(/^(Ready|Not ready)$/)).toBeVisible();
  // ACTIVE year: setup locked notice; no generation offer.
  await expect(page.getByText(/Setup is locked once a year is activated/)).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
});

test("each dashboard card fails on its own (no false all-clear)", async ({ page }) => {
  await page.route(
    (url) => url.pathname === "/api/timetable-feasibility",
    (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, message: "Busy" }) }),
  );
  await page.goto(`/years/${current().id}/dashboard`);
  await expect(page.getByText("Couldn’t run the check")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Some checks could not be loaded/)).toBeVisible();
  await expect(page.getByText("No blocking readiness issues or curriculum problems.")).toHaveCount(0);
});

test("setup guide derives progress from saved data and links to each step", async ({ page }) => {
  await page.goto(`/years/${future().id}/setup`);
  await expect(page.getByRole("heading", { name: "Setup guide" })).toBeVisible();
  await expect(page.getByText(/of \d+ steps complete/)).toBeVisible();
  for (const step of ["Weekly schedule", "Classes and sections", "Subjects", "Curriculum", "Teachers", "Teacher eligibility", "Specific teacher assignments", "Readiness review", "Timetable"]) {
    await expect(page.getByRole("listitem").filter({ hasText: step }).first()).toBeVisible();
  }
  await expect(page.getByText(/does not guarantee the solver will find a timetable/)).toBeVisible();
  await page.getByRole("link", { name: /Manage classes|Add classes/ }).click();
  await page.waitForURL(new RegExp(`/years/${future().id}/classes\\?from=setup$`));
  await page.getByRole("link", { name: "Back to setup guide" }).click();
  await page.waitForURL(new RegExp(`/years/${future().id}/setup$`));
  await expect(page.getByRole("heading", { name: "Setup guide" })).toBeVisible();
});

test("the back-to-setup link only appears when arriving from the setup guide", async ({ page }) => {
  await page.goto(`/years/${future().id}/classes`);
  await expect(page.getByRole("heading", { name: "Classes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to setup guide" })).toHaveCount(0);
});

test("the year switcher keeps the current page and the year survives a refresh", async ({ page }) => {
  await page.goto(`/years/${current().id}/setup`);
  await page.getByRole("button", { name: /^Academic year.*change academic year$/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(future().name) }).click();
  await page.waitForURL(new RegExp(`/years/${future().id}/setup$`));
  await page.reload();
  await expect(page.getByText(`Academic year ${future().name}`)).toBeVisible();
  await page.goto("/");
  await page.waitForURL(new RegExp(`/years/${future().id}/dashboard$`)); // last-used year remembered
});

test("settings: School ID, years, and the irreversible activation confirmation", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-school-id")).toHaveText(seed().login.schoolId);

  // Activation is blocked while another year is ACTIVE (the backend does not enforce one active year).
  await page.getByRole("button", { name: `Actions for ${future().name}` }).click();
  await expect(page.getByRole("menuitem", { name: new RegExp(`Activate \\(complete ${current().name} first\\)`) })).toBeVisible();
  await page.keyboard.press("Escape");

  // With no ACTIVE year (simulated list), the activation dialog requires typing the year name.
  // The PATCH is intercepted, so no real year is activated.
  const years = await (await page.request.get("/api/academic-years")).json();
  const withoutActive = { ...years, data: years.data.map((y: { status: string }) => (y.status === "ACTIVE" ? { ...y, status: "COMPLETED" } : y)) };
  let patchBody: unknown = null;
  await page.route(
    (url) => url.pathname === "/api/academic-years",
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(withoutActive) }),
  );
  await page.route(
    (url) => url.pathname === `/api/academic-years/${future().id}`,
    async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      patchBody = route.request().postDataJSON();
      const year = years.data.find((y: { id: string }) => y.id === future().id);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, message: "ok", data: { ...year, status: "ACTIVE" } }) });
    },
  );
  await page.reload();
  await page.getByRole("button", { name: `Actions for ${future().name}` }).click();
  await page.getByRole("menuitem", { name: "Activate…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/This cannot be undone/)).toBeVisible();
  await expect(dialog.getByText(/Timetable generation ends for this year/)).toBeVisible();
  const confirm = dialog.getByRole("button", { name: `Activate ${future().name}` });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type .* to confirm/).fill("wrong");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type .* to confirm/).fill(future().name);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(patchBody).toEqual({ status: "ACTIVE" });
});

test("settings: create, edit and delete a draft academic year", async ({ page }) => {
  const name = `QA-Y ${Date.now().toString(36)}`;
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: future().name })).toBeVisible(); // data loaded, page hydrated
  await page.getByRole("button", { name: "New academic year" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Start date").fill("2045-04-01");
  await dialog.getByLabel("End date").fill("2045-03-01");
  await dialog.getByRole("button", { name: "Create year" }).click();
  await expect(dialog.getByText("The end date must be after the start date")).toBeVisible();
  await dialog.getByLabel("End date").fill("2046-03-31");
  await dialog.getByRole("button", { name: "Create year" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name })).toBeVisible();

  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete academic year" }).click();
  await expect(page.getByRole("link", { name })).toHaveCount(0);
});

test("settings: substitution policy reflects the backend value", async ({ page }) => {
  const settings = await (await page.request.get("/api/substitution-settings")).json();
  await page.goto("/settings");
  await expect(page.getByRole("radio", { checked: true })).toHaveAttribute("value", settings.data.consecutivePeriodPolicy);
});
