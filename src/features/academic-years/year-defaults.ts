import type { AcademicYear } from "@/lib/api/types";

/** Non-sensitive preference cookie: the last academic year opened (used by the "/" redirect). */
export const YEAR_PREFERENCE_COOKIE = "tt_year";

/** Picks the default year: the preferred one if it exists, else ACTIVE, else the newest DRAFT, else the newest. */
export function pickDefaultYear(years: readonly AcademicYear[], preferredId?: string | null): AcademicYear | null {
  if (years.length === 0) return null;
  const preferred = preferredId ? years.find((y) => y.id === preferredId) : undefined;
  if (preferred) return preferred;
  const byStartDesc = [...years].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
  return byStartDesc.find((y) => y.status === "ACTIVE") ?? byStartDesc.find((y) => y.status === "DRAFT") ?? byStartDesc[0]!;
}
