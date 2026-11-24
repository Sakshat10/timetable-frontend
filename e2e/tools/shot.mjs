#!/usr/bin/env node
/**
 * Dev utility: screenshot a page of the running test server (http://localhost:3100) with the shared session.
 * Usage: node e2e/tools/shot.mjs <path> <name> [width] [height] [light|dark]   → test-results/shots/<name>.png
 * Prints the final URL and any console/page errors (for quick visual and runtime checks).
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , path = "/", name = "page", width = "1440", height = "900", theme = "light"] = process.argv;
const out = process.env.SHOT_DIR ?? "test-results/shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "e2e/.auth/admin.json", viewport: { width: Number(width), height: Number(height) }, colorScheme: theme });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message.slice(0, 300)}`));
await page.goto(`http://localhost:3100${path}`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
console.log(JSON.stringify({ url: page.url(), title: await page.title(), errors }));
await browser.close();
