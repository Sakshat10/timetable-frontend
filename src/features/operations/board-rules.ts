/**
 * Pure rules for the daily cover board, absences and unavailability (PHASE-0-AUDIT §1.17, §6).
 * Dates are UTC calendar dates (src/lib/dates.ts): never parsed in the browser's time zone.
 */
import type { AcademicYear } from "@/lib/api/types";
import type { Absence, AutoRun, Cover, CoverDetail } from "@/lib/api/schemas";
import { addDays, compareDates, isIsoDate, isoDatePart, type IsoDate } from "@/lib/dates";

// ------------------------------------------------------------------ date navigation

/** The board's date: the `?date=` value when it is a real calendar date, otherwise the UTC today. */
export function resolveBoardDate(param: string | null | undefined, today: IsoDate): IsoDate {
  return param && isIsoDate(param) ? param : today;
}

export function previousDay(date: IsoDate): IsoDate {
  return addDays(date, -1);
}

export function nextDay(date: IsoDate): IsoDate {
  return addDays(date, 1);
}

export type DateRelation = "past" | "today" | "future";
export function relationToToday(date: IsoDate, today: IsoDate): DateRelation {
  const c = compareDates(date, today);
  return c < 0 ? "past" : c === 0 ? "today" : "future";
}

/** The board URL for a date, optionally opening one cover. */
export function boardHref(date: IsoDate, coverId?: string | null): string {
  const params = new URLSearchParams({ date });
  if (coverId) params.set("cover", coverId);
  return `/operations?${params.toString()}`;
}

// ------------------------------------------------------------------ academic year containing a date

/**
 * The DRAFT/ACTIVE years whose dates contain `date` (the backend materialises covers from the published version
 * of such a year). More than one means the date is ambiguous and the server skips it.
 */
export function yearsContaining(years: readonly AcademicYear[], date: IsoDate): AcademicYear[] {
  return years.filter(
    (year) => (year.status === "DRAFT" || year.status === "ACTIVE") && isoDatePart(year.startDate) <= date && date <= isoDatePart(year.endDate),
  );
}

// ------------------------------------------------------------------ board

export const OPEN_STATUSES = ["OPEN", "ASSIGNED"] as const;
export const ALL_STATUSES = ["OPEN", "ASSIGNED", "CANCELLED", "OBSOLETE"] as const;

export interface CoverCounts {
  /** OPEN + ASSIGNED lessons. */
  total: number;
  assigned: number;
  open: number;
  attention: number;
  temporary: number;
  closed: number;
}

export function coverCounts(items: readonly Cover[]): CoverCounts {
  const counts: CoverCounts = { total: 0, assigned: 0, open: 0, attention: 0, temporary: 0, closed: 0 };
  for (const cover of items) {
    if (cover.status === "OPEN" || cover.status === "ASSIGNED") {
      counts.total += 1;
      if (cover.status === "OPEN") counts.open += 1;
      else counts.assigned += 1;
      if (cover.attention) counts.attention += 1;
      if (cover.status === "ASSIGNED" && cover.temporaryUnqualified) counts.temporary += 1;
    } else {
      counts.closed += 1;
    }
  }
  return counts;
}

export type GroupBy = "period" | "teacher";

export interface CoverGroup {
  key: string;
  label: string;
  items: Cover[];
}

const byPeriodThenSection = (a: Cover, b: Cover) =>
  a.periodNumber - b.periodNumber || a.section.name.localeCompare(b.section.name) || a.id.localeCompare(b.id);

/** Groups the day's covers by period (ascending) or by absent teacher (by name). */
export function groupCovers(items: readonly Cover[], by: GroupBy): CoverGroup[] {
  const map = new Map<string, CoverGroup>();
  for (const cover of items) {
    const key = by === "period" ? String(cover.periodNumber) : cover.absentTeacher.id;
    const label = by === "period" ? `Period ${cover.periodNumber}` : cover.absentTeacher.name;
    const group = map.get(key) ?? { key, label, items: [] };
    group.items.push(cover);
    map.set(key, group);
  }
  const groups = [...map.values()];
  for (const group of groups) group.items.sort(byPeriodThenSection);
  return by === "period"
    ? groups.sort((a, b) => Number(a.key) - Number(b.key))
    : groups.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export const COVER_STATUS_LABEL: Record<Cover["status"], string> = {
  OPEN: "Needs cover",
  ASSIGNED: "Assigned",
  CANCELLED: "Cancelled",
  OBSOLETE: "Obsolete",
};

export const SOURCE_LABEL: Record<"MANUAL" | "AUTOMATIC", string> = { MANUAL: "Manual", AUTOMATIC: "Automatic" };

export const ATTENTION_LABEL: Record<string, string> = {
  NO_AVAILABLE_TEACHER: "No teacher is free",
  NO_QUALIFIED_TEACHER: "No qualified teacher is free",
  CONSECUTIVE_PERIODS_NOT_ALLOWED: "Only teachers with 4+ consecutive periods are free",
  MANUAL_ASSIGNMENT_NEEDS_REVIEW: "Manual assignment needs review",
  PAST_DATE: "Date has passed",
};

/** The attention sentence to show: the backend's message, else a label for its code. */
export function attentionText(attention: Cover["attention"]): string | null {
  if (!attention) return null;
  return attention.message?.trim() || ATTENTION_LABEL[attention.code] || attention.code;
}

// ------------------------------------------------------------------ history (P1: "Cover history")

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  CREATED: "Lesson needs cover",
  ASSIGNED: "Substitute assigned",
  REASSIGNED: "Substitute replaced",
  UNASSIGNED: "Substitute removed",
  CANCELLED: "Cover cancelled",
  OBSOLETED: "Replaced by a new timetable",
  AUTO_ASSIGNED: "Assigned automatically",
  AUTO_UNFILLED: "No substitute found automatically",
  AUTO_RELEASED: "Automatic substitute released",
};

type HistoryItem = CoverDetail["history"][number];

/** One line describing a cover history entry. */
export function describeHistory(item: HistoryItem): string {
  const label = HISTORY_ACTION_LABEL[item.action] ?? "Cover updated";
  const from = item.fromTeacher?.name;
  const to = item.toTeacher?.name;
  if ((item.action === "ASSIGNED" || item.action === "AUTO_ASSIGNED") && to) return `${label}: ${to}`;
  if (item.action === "REASSIGNED" && to) return from ? `${label}: ${from} → ${to}` : `${label}: ${to}`;
  if ((item.action === "UNASSIGNED" || item.action === "AUTO_RELEASED") && from) return `${label}: ${from}`;
  return label;
}

/** History is shown newest first. */
export function historyNewestFirst(history: readonly HistoryItem[]): HistoryItem[] {
  return [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

// ------------------------------------------------------------------ cancellation reasons

/** Reasons the system writes itself; the backend rejects them as free text (400). */
export const RESERVED_CANCEL_REASONS = ["ABSENCE_CHANGED", "ABSENCE_CANCELLED", "SUBSTITUTE_ABSENT", "SUBSTITUTE_UNAVAILABLE"] as const;

export function isReservedCancelReason(reason: string): boolean {
  return (RESERVED_CANCEL_REASONS as readonly string[]).includes(reason.trim().toUpperCase());
}

// ------------------------------------------------------------------ absences

export function absenceScopeLabel(absence: Pick<Absence, "scope" | "fromPeriod" | "toPeriod">): string {
  if (absence.scope === "FULL_DAY") return "Full day";
  const { fromPeriod: from, toPeriod: to } = absence;
  if (from == null || to == null) return "Some periods";
  return from === to ? `Period ${from}` : `Periods ${from}–${to}`;
}

/**
 * The lessons listed in a refusal's `errors.lessons` ("<coverId>: 2026-11-25 period 3, Section B Physics, substitute …").
 * The leading request id is internal, so it is removed for display.
 */
export function lessonsFromDetails(details: Record<string, unknown>): string[] {
  const raw = details.lessons;
  if (!Array.isArray(raw)) return [];
  return raw.map((line) => String(line).replace(/^[0-9a-f-]{36}:\s*/i, ""));
}

/** The first `errors.absenceId` of an ABSENCE_OVERLAP refusal. */
export function overlappingAbsenceId(details: Record<string, unknown>): string | null {
  const raw = details.absenceId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === "string" && id.length > 0 ? id : null;
}

// ------------------------------------------------------------------ automatic assignment runs

export function autoRunFacts(run: AutoRun): Array<{ label: string; value: number }> {
  return [
    { label: "Considered", value: run.considered },
    { label: "Assigned", value: run.assigned },
    { label: "Still need cover", value: run.unfilled },
    { label: "Conflicts", value: run.conflicts },
    { label: "Past dates skipped", value: run.skippedPast },
    { label: "Held for review", value: run.heldForReview },
  ];
}
