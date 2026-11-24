import { isApiError } from "@/lib/api/errors";
import type { CreateTeacherBody, GradeEligibility, GradeScope, Teacher, TeacherSubjectLink, UpdateTeacherBody } from "@/lib/api/types";

/** Mirrors the backend normalisation (teacher.schema.ts): trim, upper-case, empty becomes null. */
export function normaliseEmployeeCode(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  return code === "" ? null : code;
}

/**
 * The PATCH body for an edit: only the fields that changed. An emptied employee code is sent as `null`
 * (clears it); an unchanged one is omitted.
 */
export function teacherPatch(original: Pick<Teacher, "name" | "employeeCode">, values: { name: string; employeeCode: string }): UpdateTeacherBody {
  const body: UpdateTeacherBody = {};
  const name = values.name.trim();
  if (name !== original.name) body.name = name;
  const code = normaliseEmployeeCode(values.employeeCode);
  if (code !== (original.employeeCode ?? null)) body.employeeCode = code;
  return body;
}

// ------------------------------------------------------------------ bulk creation

export interface BulkRow {
  name: string;
  employeeCode: string;
}

export const MAX_BULK_TEACHERS = 100;

/** Rows that have any content (fully blank rows are ignored, not sent). */
export function filledRows(rows: readonly BulkRow[]): BulkRow[] {
  return rows.filter((row) => row.name.trim() !== "" || row.employeeCode.trim() !== "");
}

/** The request rows for POST /teachers/bulk. Blank codes are omitted (the backend stores null). */
export function bulkPayload(rows: readonly BulkRow[]): CreateTeacherBody[] {
  return filledRows(rows).map((row) => {
    const code = normaliseEmployeeCode(row.employeeCode);
    return code === null ? { name: row.name.trim() } : { name: row.name.trim(), employeeCode: code };
  });
}

/**
 * Client-side checks before sending (the server repeats them): a name per row, at most 50 characters
 * per code, no code twice in the request. Keys are indexes into `filledRows(rows)`.
 */
export function validateBulkRows(rows: readonly BulkRow[]): Record<number, { name?: string; employeeCode?: string }> {
  const errors: Record<number, { name?: string; employeeCode?: string }> = {};
  const seen = new Map<string, number>();
  filledRows(rows).forEach((row, index) => {
    const rowErrors: { name?: string; employeeCode?: string } = {};
    if (row.name.trim() === "") rowErrors.name = "Enter a name";
    else if (row.name.trim().length > 200) rowErrors.name = "At most 200 characters";
    const code = normaliseEmployeeCode(row.employeeCode);
    if (code !== null) {
      if (code.length > 50) rowErrors.employeeCode = "At most 50 characters";
      else if (seen.has(code)) rowErrors.employeeCode = `Also used in row ${(seen.get(code) ?? 0) + 1}`;
      else seen.set(code, index);
    }
    if (rowErrors.name || rowErrors.employeeCode) errors[index] = rowErrors;
  });
  return errors;
}

/** Maps row-keyed server errors (`teachers.3.employeeCode`) to row indexes; other messages are returned as `general`. */
export function bulkServerErrors(error: unknown): { rows: Record<number, { name?: string; employeeCode?: string }>; general: string[] } {
  const rows: Record<number, { name?: string; employeeCode?: string }> = {};
  const general: string[] = [];
  if (!isApiError(error)) return { rows, general: ["Something went wrong. Please try again."] };
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const match = /^teachers\.(\d+)\.(name|employeeCode)$/.exec(path);
    if (match) {
      const index = Number(match[1]);
      rows[index] = { ...rows[index], [match[2] as "name" | "employeeCode"]: messages[0] };
    } else {
      general.push(...messages);
    }
  }
  if (Object.keys(rows).length === 0 && general.length === 0) general.push(error.message);
  return { rows, general };
}

// ------------------------------------------------------------------ eligibility (PHASE-0-AUDIT §1.7, §3.1)

/** GET /teacher-subjects/:id/grades returns rows for every academic year: keep this year's only. */
export function rowsForYear(rows: readonly GradeEligibility[] | undefined, yearId: string): GradeEligibility[] {
  return (rows ?? []).filter((row) => row.grade.academicYearId === yearId);
}

export type LinkEligibility =
  | { kind: "ALL_GRADES" }
  /** SELECTED_GRADES with no row in this year: eligible for NO grade (nothing is permitted by omission). */
  | { kind: "NONE" }
  | { kind: "SELECTED"; gradeIds: string[] };

export function linkEligibility(link: Pick<TeacherSubjectLink, "gradeScope">, rows: readonly GradeEligibility[] | undefined, yearId: string): LinkEligibility {
  if (link.gradeScope === "ALL_GRADES") return { kind: "ALL_GRADES" };
  const gradeIds = rowsForYear(rows, yearId).map((row) => row.gradeId);
  return gradeIds.length === 0 ? { kind: "NONE" } : { kind: "SELECTED", gradeIds };
}

/** Whether a link makes its teacher grade-eligible for `gradeId` (which must belong to `yearId`). */
export function isEligibleForGrade(
  link: Pick<TeacherSubjectLink, "gradeScope">,
  rows: readonly GradeEligibility[] | undefined,
  gradeId: string,
  yearId: string,
): boolean {
  const eligibility = linkEligibility(link, rows, yearId);
  if (eligibility.kind === "ALL_GRADES") return true;
  if (eligibility.kind === "NONE") return false;
  return eligibility.gradeIds.includes(gradeId);
}

export const GRADE_SCOPE_LABEL: Record<GradeScope, string> = {
  SELECTED_GRADES: "Selected grades",
  ALL_GRADES: "All grades",
};

export const LINK_TYPE_LABEL = { PRIMARY: "Primary", SECONDARY: "Secondary" } as const;

/** Short summary for a link's eligibility in the selected year. */
export function eligibilitySummary(eligibility: LinkEligibility, gradeNames: (id: string) => string | undefined): string {
  if (eligibility.kind === "ALL_GRADES") return "All grades";
  if (eligibility.kind === "NONE") return "Not eligible for any grade yet";
  const names = eligibility.gradeIds.map((id) => gradeNames(id)).filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : `${eligibility.gradeIds.length} grade(s)`;
}

export type StatusFilter = "active" | "inactive" | "all";

export function matchesStatus(teacher: Pick<Teacher, "isActive">, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return filter === "active" ? teacher.isActive : !teacher.isActive;
}
