/**
 * Absence and unavailability form rules, mirroring the backend validators
 * (substitution.schema.ts: dates YYYY-MM-DD, at most 366 days, periods 1..12, reason ≤ 500).
 */
import { z } from "zod";
import type { Absence } from "@/lib/api/schemas";
import type { CreateAbsenceBody, CreateUnavailabilityBody, UpdateAbsenceBody } from "@/lib/api/types";
import { daysInclusive, isIsoDate } from "@/lib/dates";

export const MAX_ABSENCE_DAYS = 366;
export const MAX_PERIOD = 12;
export const MAX_REASON = 500;

const dateField = z.string().trim().refine((v) => isIsoDate(v), "Enter a real date (YYYY-MM-DD)");
const periodField = z
  .number({ error: "Enter a period number" })
  .int("Enter a whole number")
  .min(1, "Periods start at 1")
  .max(MAX_PERIOD, `At most ${MAX_PERIOD} periods a day`)
  .optional();

export const absenceFormSchema = z
  .object({
    teacherId: z.string().min(1, "Choose a teacher"),
    startDate: dateField,
    endDate: dateField,
    scope: z.enum(["FULL_DAY", "PERIODS"]),
    fromPeriod: periodField,
    toPeriod: periodField,
    reason: z.string().max(MAX_REASON, `The reason must not exceed ${MAX_REASON} characters`),
    autoAssign: z.boolean(),
    allowTemporaryCover: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (isIsoDate(value.startDate) && isIsoDate(value.endDate)) {
      if (value.endDate < value.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "The last day can’t be before the first day" });
      else if (daysInclusive(value.startDate, value.endDate) > MAX_ABSENCE_DAYS)
        ctx.addIssue({ code: "custom", path: ["endDate"], message: `An absence can span at most ${MAX_ABSENCE_DAYS} days` });
    }
    if (value.scope === "PERIODS") {
      if (value.fromPeriod === undefined) ctx.addIssue({ code: "custom", path: ["fromPeriod"], message: "Enter the first period" });
      if (value.toPeriod === undefined) ctx.addIssue({ code: "custom", path: ["toPeriod"], message: "Enter the last period" });
      if (value.fromPeriod !== undefined && value.toPeriod !== undefined && value.toPeriod < value.fromPeriod)
        ctx.addIssue({ code: "custom", path: ["toPeriod"], message: "The last period can’t be before the first period" });
    }
  });

export type AbsenceFormValues = z.infer<typeof absenceFormSchema>;
export const ABSENCE_FORM_FIELDS = ["teacherId", "startDate", "endDate", "scope", "fromPeriod", "toPeriod", "reason"] as const;

export function absenceFormDefaults(today: string, absence?: Absence): AbsenceFormValues {
  if (absence) {
    return {
      teacherId: absence.teacherId,
      startDate: absence.startDate,
      endDate: absence.endDate,
      scope: absence.scope,
      fromPeriod: absence.fromPeriod ?? undefined,
      toPeriod: absence.toPeriod ?? undefined,
      reason: absence.reason ?? "",
      autoAssign: true,
      allowTemporaryCover: true,
    };
  }
  return { teacherId: "", startDate: today, endDate: today, scope: "FULL_DAY", fromPeriod: undefined, toPeriod: undefined, reason: "", autoAssign: true, allowTemporaryCover: true };
}

const periodsOf = (v: AbsenceFormValues) => (v.scope === "PERIODS" ? { fromPeriod: v.fromPeriod ?? null, toPeriod: v.toPeriod ?? null } : { fromPeriod: null, toPeriod: null });
const reasonOf = (v: AbsenceFormValues) => (v.reason.trim() === "" ? null : v.reason.trim());

export function toCreateAbsenceBody(values: AbsenceFormValues): CreateAbsenceBody {
  const periods = periodsOf(values);
  return {
    teacherId: values.teacherId,
    startDate: values.startDate,
    endDate: values.endDate,
    scope: values.scope,
    ...(values.scope === "PERIODS" ? { fromPeriod: periods.fromPeriod, toPeriod: periods.toPeriod } : {}),
    reason: reasonOf(values),
    autoAssign: values.autoAssign,
    allowTemporaryCover: values.allowTemporaryCover,
  };
}

/**
 * Only the changed fields (the teacher can never change). Returns null when nothing the backend accepts
 * as a change differs: PATCH needs at least one of the dates, scope, periods or reason.
 */
export function toUpdateAbsenceBody(values: AbsenceFormValues, original: Absence): UpdateAbsenceBody | null {
  const body: UpdateAbsenceBody = {};
  if (values.startDate !== original.startDate) body.startDate = values.startDate;
  if (values.endDate !== original.endDate) body.endDate = values.endDate;
  const periods = periodsOf(values);
  if (values.scope !== original.scope) {
    body.scope = values.scope;
    body.fromPeriod = periods.fromPeriod;
    body.toPeriod = periods.toPeriod;
  } else if (values.scope === "PERIODS" && (periods.fromPeriod !== original.fromPeriod || periods.toPeriod !== original.toPeriod)) {
    body.fromPeriod = periods.fromPeriod;
    body.toPeriod = periods.toPeriod;
  }
  const reason = reasonOf(values);
  if (reason !== (original.reason ?? null)) body.reason = reason;
  if (Object.keys(body).length === 0) return null;
  body.autoAssign = values.autoAssign;
  body.allowTemporaryCover = values.allowTemporaryCover;
  return body;
}

// ------------------------------------------------------------------ unavailability

export const unavailabilityFormSchema = z
  .object({
    teacherId: z.string().min(1, "Choose a teacher"),
    date: dateField,
    wholeDay: z.boolean(),
    periodNumber: periodField,
    reason: z.string().max(MAX_REASON, `The reason must not exceed ${MAX_REASON} characters`),
  })
  .superRefine((value, ctx) => {
    if (!value.wholeDay && value.periodNumber === undefined) ctx.addIssue({ code: "custom", path: ["periodNumber"], message: "Enter the period" });
  });

export type UnavailabilityFormValues = z.infer<typeof unavailabilityFormSchema>;
export const UNAVAILABILITY_FORM_FIELDS = ["teacherId", "date", "periodNumber", "reason"] as const;

export function toCreateUnavailabilityBody(values: UnavailabilityFormValues): CreateUnavailabilityBody {
  return {
    teacherId: values.teacherId,
    date: values.date,
    periodNumber: values.wholeDay ? null : (values.periodNumber ?? null),
    reason: values.reason.trim() === "" ? null : values.reason.trim(),
  };
}
