import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { GradeEligibility } from "@/lib/api/types";
import {
  bulkPayload,
  bulkServerErrors,
  eligibilitySummary,
  filledRows,
  isEligibleForGrade,
  linkEligibility,
  matchesStatus,
  normaliseEmployeeCode,
  rowsForYear,
  teacherPatch,
  validateBulkRows,
} from "./rules";

const Y1 = "year-1";
const Y2 = "year-2";
const row = (gradeId: string, academicYearId: string): GradeEligibility => ({
  id: `row-${gradeId}`,
  teacherSubjectId: "link",
  gradeId,
  grade: { id: gradeId, name: gradeId, displayOrder: 1, academicYearId },
  createdAt: "2026-01-01T00:00:00Z",
});

const apiError = (status: number, fieldErrors: Record<string, string[]> = {}, message = "Refused") =>
  new ApiError({ status, code: null, message, fieldErrors, details: {}, retryAfterMs: null, uncertain: false });

describe("employee code normalisation and edit patch", () => {
  it("trims, upper-cases and turns empty into null", () => {
    expect(normaliseEmployeeCode(" t-001 ")).toBe("T-001");
    expect(normaliseEmployeeCode("   ")).toBeNull();
    expect(normaliseEmployeeCode(null)).toBeNull();
  });

  it("sends only changed fields", () => {
    expect(teacherPatch({ name: "Asha", employeeCode: "T1" }, { name: " Asha ", employeeCode: "t1" })).toEqual({});
    expect(teacherPatch({ name: "Asha", employeeCode: "T1" }, { name: "Asha Rao", employeeCode: "T1" })).toEqual({ name: "Asha Rao" });
  });

  it("clears the code with null when emptied", () => {
    expect(teacherPatch({ name: "Asha", employeeCode: "T1" }, { name: "Asha", employeeCode: "" })).toEqual({ employeeCode: null });
    expect(teacherPatch({ name: "Asha", employeeCode: null }, { name: "Asha", employeeCode: "" })).toEqual({});
  });
});

describe("bulk teachers", () => {
  const rows = [
    { name: "A One", employeeCode: "qat-1" },
    { name: "", employeeCode: "" },
    { name: "B Two", employeeCode: "" },
  ];

  it("ignores blank rows and omits blank codes", () => {
    expect(filledRows(rows)).toHaveLength(2);
    expect(bulkPayload(rows)).toEqual([{ name: "A One", employeeCode: "QAT-1" }, { name: "B Two" }]);
  });

  it("flags missing names and in-request duplicate codes (case-insensitive) by filled-row index", () => {
    const errors = validateBulkRows([
      { name: "A", employeeCode: "x1" },
      { name: "", employeeCode: "" },
      { name: "", employeeCode: "y" },
      { name: "C", employeeCode: "X1" },
    ]);
    expect(errors[1]?.name).toBe("Enter a name");
    expect(errors[2]?.employeeCode).toBe("Also used in row 1");
    expect(errors[0]).toBeUndefined();
  });

  it("maps row-keyed server errors to row indexes", () => {
    const mapped = bulkServerErrors(apiError(409, { "teachers.1.employeeCode": ["Teacher with employee code \"X\" already exists in this school"] }));
    expect(mapped.rows[1]?.employeeCode).toMatch(/already exists/);
    expect(mapped.general).toEqual([]);
  });

  it("falls back to the message when nothing is row-keyed", () => {
    expect(bulkServerErrors(apiError(409, {}, "Key reused")).general).toEqual(["Key reused"]);
  });
});

describe("grade eligibility (audit §1.7, §3.1)", () => {
  const selected = { gradeScope: "SELECTED_GRADES" as const };
  const all = { gradeScope: "ALL_GRADES" as const };

  it("keeps only rows of the selected year", () => {
    expect(rowsForYear([row("g1", Y1), row("g2", Y2)], Y1).map((r) => r.gradeId)).toEqual(["g1"]);
  });

  it("SELECTED_GRADES with no rows is eligible for no grade", () => {
    expect(linkEligibility(selected, [], Y1)).toEqual({ kind: "NONE" });
    expect(linkEligibility(selected, undefined, Y1)).toEqual({ kind: "NONE" });
    expect(isEligibleForGrade(selected, [], "g1", Y1)).toBe(false);
  });

  it("rows from another year do not count", () => {
    expect(linkEligibility(selected, [row("g1", Y2)], Y1)).toEqual({ kind: "NONE" });
    expect(isEligibleForGrade(selected, [row("g1", Y2)], "g1", Y1)).toBe(false);
  });

  it("SELECTED_GRADES is eligible only for the ticked grades", () => {
    const rows = [row("g1", Y1)];
    expect(isEligibleForGrade(selected, rows, "g1", Y1)).toBe(true);
    expect(isEligibleForGrade(selected, rows, "g2", Y1)).toBe(false);
  });

  it("ALL_GRADES is eligible for every grade, rows or not", () => {
    expect(linkEligibility(all, [], Y1)).toEqual({ kind: "ALL_GRADES" });
    expect(isEligibleForGrade(all, undefined, "anything", Y1)).toBe(true);
  });

  it("summarises explicitly", () => {
    expect(eligibilitySummary({ kind: "NONE" }, () => undefined)).toBe("Not eligible for any grade yet");
    expect(eligibilitySummary({ kind: "ALL_GRADES" }, () => undefined)).toBe("All grades");
    expect(eligibilitySummary({ kind: "SELECTED", gradeIds: ["g1"] }, () => "Grade 8")).toBe("Grade 8");
  });

  it("filters by status", () => {
    expect(matchesStatus({ isActive: false }, "active")).toBe(false);
    expect(matchesStatus({ isActive: false }, "inactive")).toBe(true);
    expect(matchesStatus({ isActive: true }, "all")).toBe(true);
  });
});
