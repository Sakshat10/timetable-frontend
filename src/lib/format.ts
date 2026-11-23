import type { AcademicYearStatus, DayOfWeek, RunStatus, VersionStatus } from "@/lib/api/types";

export const DAY_LABEL: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

export const DAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

export const YEAR_STATUS_LABEL: Record<AcademicYearStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  COMPLETED: "Completed",
};

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  ARCHIVED: "Archived",
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCEEDED: "Completed",
  FAILED: "Failed",
};

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export function periodLabel(periodNumber: number): string {
  return `P${periodNumber}`;
}

/** A section's display name including its grade ("Grade 8 · A"). */
export function sectionLabel(gradeName: string | null | undefined, sectionName: string): string {
  return gradeName ? `${gradeName} · ${sectionName}` : sectionName;
}
