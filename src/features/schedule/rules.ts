import { DAYS_OF_WEEK, type DayOfWeek, type ScheduleConfig, type UpdateScheduleBody } from "@/lib/api/types";

/** schedule-config.schema.ts: periodsPerDay 2..12, breakAfterPeriod 1..periodsPerDay-1, 1-7 distinct working days. */
export const MIN_PERIODS = 2;
export const MAX_PERIODS = 12;

export interface ScheduleValues {
  workingDays: DayOfWeek[];
  periodsPerDay: number;
  breakAfterPeriod: number;
}

export const DEFAULT_SCHEDULE: ScheduleValues = {
  workingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
  periodsPerDay: 8,
  breakAfterPeriod: 4,
};

/** Working days in week order, without duplicates. */
export function orderDays(days: readonly DayOfWeek[]): DayOfWeek[] {
  return DAYS_OF_WEEK.filter((d) => days.includes(d));
}

export type ScheduleErrors = Partial<Record<keyof ScheduleValues, string>>;

export function validateSchedule(values: { workingDays: readonly DayOfWeek[]; periodsPerDay: number | undefined; breakAfterPeriod: number | undefined }): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (values.workingDays.length === 0) errors.workingDays = "Choose at least one working day";
  const p = values.periodsPerDay;
  if (p === undefined || !Number.isInteger(p) || p < MIN_PERIODS || p > MAX_PERIODS) {
    errors.periodsPerDay = `Enter a whole number from ${MIN_PERIODS} to ${MAX_PERIODS}`;
  } else {
    const b = values.breakAfterPeriod;
    if (b === undefined || !Number.isInteger(b) || b < 1 || b > p - 1) errors.breakAfterPeriod = `Choose a period from 1 to ${p - 1}`;
  }
  return errors;
}

/** Keeps the break between two teaching periods when the number of periods changes. */
export function clampBreak(breakAfterPeriod: number, periodsPerDay: number): number {
  return Math.min(Math.max(1, breakAfterPeriod), Math.max(1, periodsPerDay - 1));
}

export function weeklyCapacity(values: Pick<ScheduleValues, "workingDays" | "periodsPerDay">): number {
  return new Set(values.workingDays).size * values.periodsPerDay;
}

export type PreviewItem = { kind: "PERIOD"; periodNumber: number } | { kind: "BREAK"; afterPeriod: number };

/** One school day: P1…Pn with the single break after `breakAfterPeriod` (the break is not a period). */
export function dayPreview(periodsPerDay: number, breakAfterPeriod: number | null): PreviewItem[] {
  const items: PreviewItem[] = [];
  for (let p = 1; p <= periodsPerDay; p++) {
    items.push({ kind: "PERIOD", periodNumber: p });
    if (breakAfterPeriod !== null && p === breakAfterPeriod && p < periodsPerDay) items.push({ kind: "BREAK", afterPeriod: p });
  }
  return items;
}

/**
 * The PATCH body: only the changed fields. When the number of periods changes and the stored break would no
 * longer fit, the break is always sent too (the server validates the merged result).
 */
export function schedulePatch(config: Pick<ScheduleConfig, "workingDays" | "periodsPerDay" | "breakAfterPeriod">, values: ScheduleValues): UpdateScheduleBody {
  const body: UpdateScheduleBody = {};
  const days = orderDays(values.workingDays);
  const current = orderDays(config.workingDays);
  if (days.length !== current.length || days.some((d, i) => d !== current[i])) body.workingDays = days;
  if (values.periodsPerDay !== config.periodsPerDay) body.periodsPerDay = values.periodsPerDay;
  const breakChanged = values.breakAfterPeriod !== config.breakAfterPeriod;
  const breakOutside = config.breakAfterPeriod === null || config.breakAfterPeriod > values.periodsPerDay - 1;
  if (breakChanged || (body.periodsPerDay !== undefined && breakOutside)) body.breakAfterPeriod = values.breakAfterPeriod;
  return body;
}

export function valuesFromConfig(config: Pick<ScheduleConfig, "workingDays" | "periodsPerDay" | "breakAfterPeriod">): ScheduleValues {
  return {
    workingDays: orderDays(config.workingDays),
    periodsPerDay: config.periodsPerDay,
    breakAfterPeriod: config.breakAfterPeriod ?? clampBreak(Math.floor(config.periodsPerDay / 2), config.periodsPerDay),
  };
}
