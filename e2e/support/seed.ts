import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The disposable backend's seed manifest (written by timetable-backend/e2e/dashboard/e2e.sh seed).
 * Read-only: gives the test school's id, credentials and well-known record ids.
 */
export interface SeedManifest {
  login: { schoolId: string; email: string; password: string };
  dates: { anchorUtc: string; referenceWorkingDay: string; wd: Record<string, string> };
  academicYears: Record<"previous" | "current" | "future", { id: string; name: string; status: string; startDate: string; endDate: string }>;
  [key: string]: unknown;
}

const MANIFEST = process.env.E2E_SEED_MANIFEST ?? join(homedir(), "Desktop/timetable-backend/e2e/dashboard/.run/seed-manifest.json");

let cached: SeedManifest | null = null;
export function seed(): SeedManifest {
  cached ??= JSON.parse(readFileSync(MANIFEST, "utf8")) as SeedManifest;
  return cached;
}
