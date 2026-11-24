import { expect, request, test, type Page } from "@playwright/test";
import { seed } from "./support/seed";

/**
 * [real] Cross-site request protection and Content-Security-Policy (release hardening; FINAL-PRODUCTION-READINESS-REPORT
 * S3/S4). An "attacker" page is served from a different SITE, http://127.0.0.1:3100 (127.0.0.1 and localhost are
 * different sites; the attacker HTML is supplied by page.route, so the browser treats it as a genuine cross-site
 * origin and sends Origin: http://127.0.0.1:3100 and Sec-Fetch-Site: cross-site). A loopback attacker origin is
 * used because Chrome's Private Network Access blocks a "public" test origin from reaching localhost at all,
 * which would hide what the server-side guard does. Requests then go for real to the Next.js server on :3100 and, when allowed,
 * on to the disposable backend.
 *
 * Each test runs in its own browser context created from the shared session, so even a failure could only clear
 * the cookie in that context; the shared session's server-side row is never deleted (logout without a cookie
 * cannot delete it).
 */
const ATTACKER = "http://127.0.0.1:3100";
const APP = "http://localhost:3100";

async function attackerPage(page: Page, html: string) {
  await page.route(`${ATTACKER}/attack.html`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><body>${html}</body></html>` }));
  await page.goto(`${ATTACKER}/attack.html`);
}

async function sessionValid(page: Page): Promise<number> {
  return (await page.context().request.get(`${APP}/api/admin/me`)).status();
}

test("[real] a cross-site form POST to logout is blocked and the session survives", async ({ page }) => {
  expect(await sessionValid(page)).toBe(200);
  await attackerPage(
    page,
    `<form id="f" method="POST" action="${APP}/api/admin/logout" enctype="text/plain"><input name='{"a":"' value='"}'></form>`,
  );
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url() === `${APP}/api/admin/logout`),
    page.evaluate(() => (document.getElementById("f") as HTMLFormElement).submit()),
  ]);
  expect(response.status()).toBe(403);
  expect(response.headers()["x-blocked-reason"]).toBe("cross-origin");
  expect(response.headers()["set-cookie"]).toBeUndefined(); // nothing reached the backend, so no cookie is cleared
  expect((await page.context().cookies()).some((c) => c.name === "session_token")).toBe(true);
  expect(await sessionValid(page)).toBe(200);
});

test("[real] other cross-site state-changing requests are blocked before reaching the backend", async ({ page }) => {
  const teachers = await (await page.context().request.get(`${APP}/api/teachers`)).json();
  const teacherId = teachers.data[0].id as string;
  await attackerPage(
    page,
    `<form id="f" method="POST" action="${APP}/api/subjects" enctype="application/x-www-form-urlencoded"><input name="name" value="Hacked"><input name="code" value="HCK"></form>`,
  );
  // 1. A form POST (simple request, no preflight).
  const [formResponse] = await Promise.all([
    page.waitForResponse((r) => r.url() === `${APP}/api/subjects` && r.request().method() === "POST"),
    page.evaluate(() => (document.getElementById("f") as HTMLFormElement).submit()),
  ]);
  expect(formResponse.status()).toBe(403);
  expect(formResponse.headers()["x-blocked-reason"]).toBe("cross-origin");

  // 2. A no-cors fetch POST with a text/plain body (also a simple request). The attacker never sees the answer: the
  // response is opaque, and Chrome's Opaque Response Blocking turns a JSON answer into a network error. What matters
  // is that the request reached the server and was refused there, which the network log and the absence of any
  // created record show.
  await attackerPage(page, "");
  const [sent] = await Promise.all([
    page.waitForRequest((r) => r.url() === `${APP}/api/teacher-absences` && r.method() === "POST"),
    page.evaluate(
      ({ app, teacher }) =>
        fetch(`${app}/api/teacher-absences`, {
          method: "POST",
          mode: "no-cors",
          credentials: "include",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ teacherId: teacher, startDate: "2099-01-05", endDate: "2099-01-05" }),
        })
          .then(() => "resolved")
          .catch(() => "network error (opaque response)"),
      { app: APP, teacher: teacherId },
    ),
  ]);
  // Observed: Chromium sends `Origin: http://127.0.0.1:3100` (and no Sec-Fetch-Site) on this request, and Playwright
  // records no response for it because ORB fails it in the browser. Replay EXACTLY what the browser sent (its Origin,
  // content type, body, plus the session cookie a browser would attach) to observe the server's answer.
  const sentHeaders = await sent.allHeaders();
  expect(sentHeaders.origin).toBe(ATTACKER);
  const cookie = (await page.context().cookies()).find((c) => c.name === "session_token")!;
  const replay = await request.newContext({ extraHTTPHeaders: { Origin: sentHeaders.origin!, Cookie: `session_token=${cookie.value}` } });
  const replayed = await replay.post(`${APP}/api/teacher-absences`, { headers: { "Content-Type": "text/plain" }, data: sent.postData() ?? "" });
  expect(replayed.status()).toBe(403);
  expect(replayed.headers()["x-blocked-reason"]).toBe("cross-origin");
  await replay.dispose();

  // 3. Methods that need a CORS preflight (DELETE, JSON) never reach the server from another origin.
  const deleted = await page.evaluate(
    (app) =>
      fetch(`${app}/api/teacher-unavailability/00000000-0000-4000-8000-000000000000`, { method: "DELETE", credentials: "include" })
        .then((r) => `STATUS ${r.status}`)
        .catch((e: Error) => `BLOCKED ${e.name}`),
    APP,
  );
  expect(deleted).toBe("BLOCKED TypeError");

  // 4. Cross-site credentialed reads stay unreadable (CORS).
  const read = await page.evaluate(
    (app) =>
      fetch(`${app}/api/admin/me`, { credentials: "include" })
        .then((r) => r.text())
        .catch((e: Error) => `BLOCKED ${e.name}`),
    APP,
  );
  expect(read).toBe("BLOCKED TypeError");

  // Nothing was created by the blocked requests.
  const subjects = await (await page.context().request.get(`${APP}/api/subjects`)).json();
  expect((subjects.data as Array<{ code: string }>).some((s) => s.code === "HCK")).toBe(false);
  const absences = await (await page.context().request.get(`${APP}/api/teacher-absences?from=2099-01-01&to=2099-12-31`)).json();
  expect(absences.data).toEqual([]);
});

test("[real] legitimate same-origin writes and non-browser API clients still reach the backend", async ({ page, baseURL }) => {
  // Same-origin browser write: an invalid body is refused by the BACKEND with its own 400 envelope (not the guard's 403).
  await page.goto(`/years/${seed().academicYears.future.id}/dashboard`);
  const sameOrigin = await page.evaluate(() =>
    fetch("/api/subjects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }).then(async (r) => ({
      status: r.status,
      blocked: r.headers.get("x-blocked-reason"),
      body: await r.json(),
    })),
  );
  expect(sameOrigin.status).toBe(400);
  expect(sameOrigin.blocked).toBeNull();
  expect(JSON.stringify(sameOrigin.body)).not.toContain("did not come from this application");

  // A real same-origin write through the UI still succeeds: save the substitution policy unchanged.
  const before = (await (await page.context().request.get("/api/substitution-settings")).json()).data.consecutivePeriodPolicy as string;
  await page.goto("/settings");
  const radio = page.getByRole("radio", { checked: true });
  await expect(radio).toHaveAttribute("value", before);
  const other = before === "ALLOW" ? "PREFER_AVOID" : "ALLOW";
  const [put] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/substitution-settings") && r.request().method() === "PUT"),
    page.locator(`#policy-${other}`).click(),
  ]);
  expect(put.status()).toBe(200);
  const [restore] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/substitution-settings") && r.request().method() === "PUT"),
    page.locator(`#policy-${before}`).click(),
  ]);
  expect(restore.status()).toBe(200);

  // Non-browser client (no Origin, no Fetch Metadata) is not blocked by the guard.
  const api = await request.newContext({ baseURL, storageState: "e2e/.auth/admin.json" });
  const nonBrowser = await api.post("/api/subjects", { data: {} });
  expect(nonBrowser.status()).toBe(400);
  expect(nonBrowser.headers()["x-blocked-reason"]).toBeUndefined();
  await api.dispose();
});

test("[real] pages carry a strict, per-request script CSP", async ({ page }) => {
  const first = await page.goto("/login");
  const secondResponse = await (await request.newContext()).get(`${APP}/login`);
  const csp = first!.headers()["content-security-policy"] ?? "";
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
  expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
  expect(script).toContain("'strict-dynamic'");
  expect(script).not.toContain("'unsafe-inline'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("connect-src 'self'");
  const nonceOf = (value: string) => /'nonce-([^']+)'/.exec(value)?.[1];
  const secondCsp = secondResponse.headers()["content-security-policy"] ?? "";
  expect(nonceOf(secondCsp)).not.toBe(nonceOf(csp)); // fresh per request
  // Every <script> in the server-rendered HTML carries this response's nonce (later scripts are loaded by
  // nonce'd scripts, which 'strict-dynamic' permits).
  const html = await secondResponse.text();
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  const withoutNonce = tags.filter((tag) => !tag.includes(`nonce="${nonceOf(secondCsp)}"`));
  expect(withoutNonce).toEqual([]);
});

test("[real] the signed-in app runs without CSP violations", async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  for (const path of [`/years/${seed().academicYears.current.id}/dashboard`, "/operations", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /^Academic year/ }).click();
    await expect(page.getByRole("menu")).toBeVisible(); // hydrated and interactive under the CSP
    await page.keyboard.press("Escape");
    violations.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)));
  }
  expect(violations).toEqual([]);
});
