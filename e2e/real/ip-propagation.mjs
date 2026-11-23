#!/usr/bin/env node
/**
 * AUTH-PROXY-TEST-PLAN T5: which client address does Fastify see through the Next.js forwarding layer,
 * is the login limiter per client, and can a client spoof X-Forwarded-For?
 *
 * - Starts a SECOND backend (port 4011) from the backend checkout with env vars only (NODE_ENV=production,
 *   LOG_LEVEL=info, TRUST_PROXY=<case>) against the disposable database timetable_dashboard_e2e_test.
 *   No backend file is changed. Only failed logins and unauthenticated reads are sent: nothing is written.
 * - Starts a Next.js instance on [::]:3100 (separate distDir) forwarding /api/* to 4011.
 * - Clients: 127.0.0.1 (IPv4 loopback), ::1 (IPv6 loopback), the LAN address (en0).
 * - Primary observation: Fastify's request log `remoteAddress` (= request.ip after TRUST_PROXY).
 *   Secondary: whether two clients share a login rate-limit bucket.
 *
 * Usage: node e2e/real/ip-propagation.mjs [--next-mode=dev|start]   (writes e2e/.results/ip-propagation.md)
 */
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FRONTEND = resolve(new URL("../..", import.meta.url).pathname);
const BACKEND = resolve(homedir(), "Desktop/timetable-backend");
const RESULTS = join(FRONTEND, "e2e/.results");
const DB = "timetable_dashboard_e2e_test";
const DATABASE_URL = `postgresql://${userInfo().username}@localhost:5432/${DB}`;
const BACKEND_PORT = 4011;
const NEXT_PORT = 3100;
const nextMode = (process.argv.find((a) => a.startsWith("--next-mode=")) ?? "--next-mode=dev").split("=")[1];
/** Emulated trusted front proxy in front of Next.js: none | overwrite (XFF = socket address) | append (XFF += socket address). */
const front = (process.argv.find((a) => a.startsWith("--front=")) ?? "--front=none").split("=")[1];
const FRONT_PORT = 3200;
const LAN = execFileSync("ipconfig", ["getifaddr", "en0"]).toString().trim();
const CLIENTS = { ipv4: { host: "127.0.0.1", flag: "-4" }, ipv6: { host: "[::1]", flag: "-6" }, lan: { host: LAN, flag: "-4" } };

mkdirSync(RESULTS, { recursive: true });
const logFile = (name) => join(RESULTS, name);
if (!DATABASE_URL.endsWith(`/${DB}`)) throw new Error("refusing: not the disposable database");

function portFree(port) {
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return false;
  } catch {
    return true;
  }
}

async function waitFor(url, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function startBackend(trustProxy, log) {
  if (!portFree(BACKEND_PORT)) throw new Error(`port ${BACKEND_PORT} is busy`);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    DATABASE_URL,
    DOTENV_CONFIG_PATH: "/nonexistent/disabled",
    DOTENV_CONFIG_QUIET: "true",
    NODE_ENV: "production",
    PORT: String(BACKEND_PORT),
    HOST: "127.0.0.1",
    FRONTEND_URL: `http://localhost:${NEXT_PORT}`,
    COOKIE_SECRET: randomBytes(36).toString("base64"),
    LOG_LEVEL: "info",
    TRUST_PROXY: trustProxy,
    GENERATION_RUNNER_ENABLED: "false",
  };
  const child = spawn("node", ["--import", "tsx", "src/server.ts"], { cwd: BACKEND, env, stdio: ["ignore", "pipe", "pipe"] });
  const chunks = [];
  child.stdout.on("data", (d) => chunks.push(d));
  child.stderr.on("data", (d) => chunks.push(d));
  child.flush = () => writeFileSync(log, Buffer.concat(chunks));
  child.text = () => Buffer.concat(chunks).toString();
  return child;
}

function startNext() {
  if (!portFree(NEXT_PORT)) throw new Error(`port ${NEXT_PORT} is busy`);
  const env = { ...process.env, BACKEND_URL: `http://127.0.0.1:${BACKEND_PORT}`, NEXT_DIST_DIR: ".next-ip", NODE_ENV: undefined };
  const args = nextMode === "start" ? ["next", "start", "-H", "::", "-p", String(NEXT_PORT)] : ["next", "dev", "-H", "::", "-p", String(NEXT_PORT)];
  if (nextMode === "start") execFileSync("npx", ["next", "build"], { cwd: FRONTEND, env: { ...env, NODE_ENV: "production" }, stdio: "inherit" });
  return spawn("npx", args, { cwd: FRONTEND, env, stdio: ["ignore", "ignore", "ignore"], detached: true });
}

/** curl from a given client address; returns the HTTP status. */
function curl(client, path, { method = "GET", body, headers = {}, port = front === "none" ? NEXT_PORT : FRONT_PORT, host } = {}) {
  const c = CLIENTS[client];
  const url = `http://${host ?? c.host}:${port}${path}`;
  const args = ["-s", "-o", "/dev/null", "-w", "%{http_code}", c.flag, "-m", "15", "-X", method, url];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  if (body) args.push("-H", "Content-Type: application/json", "--data", JSON.stringify(body));
  return execFileSync("curl", args).toString().trim();
}

function seenAddress(backend, marker) {
  for (const line of backend.text().split("\n")) {
    if (!line.includes(marker)) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.req?.remoteAddress) return entry.req.remoteAddress;
    } catch {
      /* not JSON */
    }
  }
  return "(not logged)";
}

const failedLogin = () => ({ schoolId: randomUUID(), email: "nobody@example.invalid", password: "wrong-password" });

async function runCase(trustProxy) {
  const backend = startBackend(trustProxy, logFile(`backend-trust-${trustProxy}.log`));
  try {
    await waitFor(`http://127.0.0.1:${BACKEND_PORT}/health`);
    const rows = [];
    // T5.1 baseline (direct)
    const m0 = `probe-${randomUUID()}`;
    curl("ipv4", `/api/admin/me?m=${m0}`, { port: BACKEND_PORT, host: "127.0.0.1", headers: { "X-Forwarded-For": "198.51.100.1" } });
    // T5.2 through Next from three clients
    const marks = {};
    for (const client of Object.keys(CLIENTS)) {
      marks[client] = `probe-${randomUUID()}`;
      curl(client, `/api/admin/me?m=${marks[client]}`);
    }
    // client-supplied XFF through Next (LAN client)
    const mSpoof = `probe-${randomUUID()}`;
    curl("lan", `/api/admin/me?m=${mSpoof}`, { headers: { "X-Forwarded-For": "203.0.113.7" } });
    await sleep(500);
    rows.push(["T5.1 direct from 127.0.0.1 (+XFF 198.51.100.1)", "127.0.0.1", seenAddress(backend, m0)]);
    rows.push(["T5.2 via Next from 127.0.0.1", "127.0.0.1", seenAddress(backend, marks.ipv4)]);
    rows.push(["T5.2 via Next from ::1", "::1", seenAddress(backend, marks.ipv6)]);
    rows.push([`T5.2 via Next from ${LAN}`, LAN, seenAddress(backend, marks.lan)]);
    rows.push([`T5.5 via Next from ${LAN} sending XFF 203.0.113.7`, LAN, seenAddress(backend, mSpoof)]);

    // T5.3/T5.4 limiter isolation: exhaust LAN client's bucket, then try IPv6 client.
    const lanStatuses = [];
    for (let i = 0; i < 6; i++) lanStatuses.push(curl("lan", "/api/admin/login", { method: "POST", body: failedLogin() }));
    const otherClient = curl("ipv6", "/api/admin/login", { method: "POST", body: failedLogin() });
    // T5.5 spoof against the limiter: exhausted LAN client pretends to be someone else.
    const spoofA = curl("lan", "/api/admin/login", { method: "POST", body: failedLogin(), headers: { "X-Forwarded-For": "203.0.113.7" } });
    const spoofB = curl("lan", "/api/admin/login", { method: "POST", body: failedLogin(), headers: { "X-Forwarded-For": "::1" } });
    return {
      trustProxy,
      rows,
      limiter: { lanStatuses, otherClient, spoofA, spoofB },
    };
  } finally {
    backend.flush();
    backend.kill("SIGTERM");
    for (let i = 0; i < 40 && !portFree(BACKEND_PORT); i++) await sleep(250);
  }
}

function startFront() {
  const child = spawn("node", [join(FRONTEND, "e2e/real/front-proxy.mjs"), String(FRONT_PORT), String(NEXT_PORT), front], { stdio: "ignore" });
  return { close: () => child.kill("SIGTERM") };
}

const next = startNext();
const frontServer = front === "none" ? null : startFront();
const results = [];
try {
  await waitFor(`http://127.0.0.1:${NEXT_PORT}/login`, 240_000);
  for (const trust of front === "none" ? ["false", "1", "loopback"] : ["false", "1"]) results.push(await runCase(trust));
} finally {
  frontServer?.close();
  try {
    process.kill(-next.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

let md = `# T5 client-IP propagation results\n\nRun: ${new Date().toISOString()} · Next.js mode: \`${nextMode}\` · forwarding: \`rewrites()\` (option A) · front proxy: \`${front}\` · backend NODE_ENV=production on :${BACKEND_PORT}\n\n`;
for (const r of results) {
  md += `## TRUST_PROXY=${r.trustProxy}\n\n| Case | Real client | Fastify request.ip |\n|---|---|---|\n`;
  for (const [name, real, seen] of r.rows) md += `| ${name} | ${real} | ${seen} |\n`;
  md += `\nLimiter: LAN client 6 failed logins → ${r.limiter.lanStatuses.join(", ")}; then IPv6 client → **${r.limiter.otherClient}** (401 = own bucket, 429 = shared bucket); exhausted LAN client with spoofed XFF 203.0.113.7 → **${r.limiter.spoofA}**, with XFF ::1 → **${r.limiter.spoofB}** (429 = spoof rejected).\n\n`;
}
writeFileSync(join(RESULTS, `ip-propagation-${nextMode}-front-${front}.md`), md);
console.log(md);
if (existsSync(join(FRONTEND, ".next-ip"))) console.log("(build output in .next-ip is git-ignored scratch)");
