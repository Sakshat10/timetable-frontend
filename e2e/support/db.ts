import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

/**
 * Direct SQL for the few tests that need it (AUTH-PROXY-TEST-PLAN T4.1/T4.2), ONLY on the disposable
 * database. Refuses anything else. Values are validated hex (no user input reaches SQL).
 */
const DB = "timetable_dashboard_e2e_test";
const HOST = "localhost";

function psql(sql: string): string {
  const identity = execFileSync("psql", ["-X", "-At", "-h", HOST, "-U", userInfo().username, "-d", DB, "-c", "select current_database()"]).toString().trim();
  if (identity !== DB) throw new Error(`Refusing to run SQL: connected to ${identity}, expected ${DB}`);
  return execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-h", HOST, "-U", userInfo().username, "-d", DB, "-c", sql]).toString().trim();
}

function tokenHash(token: string): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("unexpected session token format");
  return createHash("sha256").update(token).digest("hex");
}

export function sessionRow(token: string): { expiresAt: string; lastUsedAt: string } | null {
  const out = psql(`select "expiresAt", "lastUsedAt" from admin_sessions where "sessionToken" = '${tokenHash(token)}'`);
  if (!out) return null;
  const [expiresAt = "", lastUsedAt = ""] = out.split("|");
  return { expiresAt, lastUsedAt };
}

export function expireSession(token: string): void {
  psql(`update admin_sessions set "expiresAt" = now() - interval '1 minute' where "sessionToken" = '${tokenHash(token)}'`);
}
