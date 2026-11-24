import { describe, expect, it } from "vitest";
import type { Absence } from "@/lib/api/schemas";
import {
  absenceFormDefaults,
  absenceFormSchema,
  toCreateAbsenceBody,
  toCreateUnavailabilityBody,
  toUpdateAbsenceBody,
  unavailabilityFormSchema,
  type AbsenceFormValues,
} from "./absence-form";

const valid: AbsenceFormValues = { ...absenceFormDefaults("2026-11-24"), teacherId: "t1" };

function errorsOf(values: Partial<AbsenceFormValues>) {
  const result = absenceFormSchema.safeParse({ ...valid, ...values });
  return result.success ? {} : Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message]));
}

describe("absence form validation", () => {
  it("accepts a single full day", () => {
    expect(errorsOf({})).toEqual({});
  });

  it("requires a teacher and real dates", () => {
    expect(errorsOf({ teacherId: "" })).toHaveProperty("teacherId");
    expect(errorsOf({ startDate: "2026-02-30" })).toHaveProperty("startDate");
    expect(errorsOf({ endDate: "24/11/2026" })).toHaveProperty("endDate");
  });

  it("refuses an end before the start", () => {
    expect(errorsOf({ startDate: "2026-11-25", endDate: "2026-11-24" })).toHaveProperty("endDate");
  });

  it("allows up to 366 days inclusive and refuses 367", () => {
    expect(errorsOf({ startDate: "2027-01-01", endDate: "2028-01-01" })).toEqual({}); // 366 days
    expect(errorsOf({ startDate: "2027-01-01", endDate: "2028-01-02" }).endDate).toMatch(/366/);
    expect(errorsOf({ startDate: "2028-01-01", endDate: "2028-12-31" })).toEqual({}); // leap year, 366 days
  });

  it("validates period ranges for a PERIODS absence", () => {
    expect(errorsOf({ scope: "PERIODS" })).toMatchObject({ fromPeriod: expect.any(String), toPeriod: expect.any(String) });
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 4, toPeriod: 2 })).toHaveProperty("toPeriod");
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 0, toPeriod: 2 })).toHaveProperty("fromPeriod");
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 1, toPeriod: 13 })).toHaveProperty("toPeriod");
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 2.5, toPeriod: 3 })).toHaveProperty("fromPeriod");
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 3, toPeriod: 3 })).toEqual({});
    expect(errorsOf({ scope: "PERIODS", fromPeriod: 1, toPeriod: 12 })).toEqual({});
  });

  it("limits the reason to 500 characters", () => {
    expect(errorsOf({ reason: "x".repeat(500) })).toEqual({});
    expect(errorsOf({ reason: "x".repeat(501) })).toHaveProperty("reason");
  });
});

describe("request bodies", () => {
  it("sends periods only for a PERIODS absence and null for an empty reason", () => {
    expect(toCreateAbsenceBody({ ...valid, fromPeriod: 2, toPeriod: 3 })).toEqual({
      teacherId: "t1",
      startDate: "2026-11-24",
      endDate: "2026-11-24",
      scope: "FULL_DAY",
      reason: null,
      autoAssign: true,
      allowTemporaryCover: true,
    });
    expect(toCreateAbsenceBody({ ...valid, scope: "PERIODS", fromPeriod: 2, toPeriod: 3, reason: " Training " })).toMatchObject({ scope: "PERIODS", fromPeriod: 2, toPeriod: 3, reason: "Training" });
  });

  const original = {
    id: "a",
    teacherId: "t1",
    startDate: "2026-11-24",
    endDate: "2026-11-24",
    scope: "PERIODS",
    fromPeriod: 2,
    toPeriod: 3,
    reason: "Old",
    status: "ACTIVE",
  } as Absence;

  it("sends only changed fields, never the teacher", () => {
    const values = absenceFormDefaults("2026-11-24", original);
    expect(toUpdateAbsenceBody(values, original)).toBeNull();
    expect(toUpdateAbsenceBody({ ...values, reason: "New" }, original)).toEqual({ reason: "New", autoAssign: true, allowTemporaryCover: true });
    expect(toUpdateAbsenceBody({ ...values, scope: "FULL_DAY" }, original)).toMatchObject({ scope: "FULL_DAY", fromPeriod: null, toPeriod: null });
    expect(toUpdateAbsenceBody({ ...values, toPeriod: 5 }, original)).toMatchObject({ fromPeriod: 2, toPeriod: 5 });
    expect(toUpdateAbsenceBody({ ...values, teacherId: "other", reason: "New" }, original)).not.toHaveProperty("teacherId");
  });

  it("unavailability: whole day sends periodNumber null and a period is required otherwise", () => {
    const base = { teacherId: "t", date: "2026-11-25", wholeDay: true, periodNumber: undefined, reason: "" };
    expect(unavailabilityFormSchema.safeParse(base).success).toBe(true);
    expect(unavailabilityFormSchema.safeParse({ ...base, wholeDay: false }).success).toBe(false);
    expect(toCreateUnavailabilityBody(base)).toEqual({ teacherId: "t", date: "2026-11-25", periodNumber: null, reason: null });
    expect(toCreateUnavailabilityBody({ ...base, wholeDay: false, periodNumber: 4, reason: "Meeting" })).toEqual({ teacherId: "t", date: "2026-11-25", periodNumber: 4, reason: "Meeting" });
  });
});
