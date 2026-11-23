/**
 * Calendar-date helpers for operational dates (absences, covers, unavailability).
 *
 * The backend stores these as UTC calendar dates (`YYYY-MM-DD`) and decides "today" with the UTC date
 * (PHASE-0-AUDIT.md §6.2). We never pass them through the browser's time zone: every computation works
 * on the string or on a Date at UTC midnight, and formatting uses timeZone "UTC".
 */
import type { DayOfWeek } from "@/lib/api/types";

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): value is IsoDate {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Today's UTC calendar date: the same "today" the backend uses. */
export function todayUtc(now: Date = new Date()): IsoDate {
  return now.toISOString().slice(0, 10);
}

function toUtcDate(value: IsoDate): Date {
  const match = ISO_DATE.exec(value);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive number of days between two dates. */
export function daysInclusive(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / 86_400_000) + 1;
}

const WEEKDAYS: DayOfWeek[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

/** The weekday of a calendar date, as the backend computes it (UTC). */
export function weekdayOf(value: IsoDate): DayOfWeek {
  return WEEKDAYS[toUtcDate(value).getUTCDay()]!;
}

const longFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const plainFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "Tuesday 24 November 2026" */
export function formatDateLong(value: IsoDate): string {
  return longFormat.format(toUtcDate(value));
}
/** "Tue 24 Nov" */
export function formatDateShort(value: IsoDate): string {
  return shortFormat.format(toUtcDate(value));
}
/** "24 Nov 2026" */
export function formatDate(value: IsoDate): string {
  return plainFormat.format(toUtcDate(value));
}

/** "24 Nov – 26 Nov 2026" or a single date. */
export function formatDateRange(from: IsoDate, to: IsoDate): string {
  return from === to ? formatDate(from) : `${formatDateShort(from)} – ${formatDate(to)}`;
}

/** Academic-year dates arrive as ISO datetimes at UTC midnight: keep only the calendar part. */
export function isoDatePart(datetime: string): IsoDate {
  return datetime.slice(0, 10);
}

const timestampFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** An instant (createdAt, publishedAt…) in the viewer's locale and time zone. */
export function formatTimestamp(datetime: string): string {
  return timestampFormat.format(new Date(datetime));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "3 minutes ago" for an instant. */
export function formatRelative(datetime: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(datetime).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return relative.format(Math.round(seconds), "second");
  if (abs < 2700) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 79_200) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}
