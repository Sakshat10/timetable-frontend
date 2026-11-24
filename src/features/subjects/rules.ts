/**
 * Pure rules for the Subjects page (PHASE-0-AUDIT §1.4): code normalisation, the bulk payload with its
 * row-keyed errors, and per-grade usage from the curriculum overview.
 */
import { z } from "zod";
import type { CreateSubjectBody } from "@/lib/api/types";
import type { CurriculumOverview } from "@/lib/api/schemas";
import type { PathErrors } from "@/features/curriculum/form-errors";

export const MAX_BULK_SUBJECTS = 100;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/;
export const CODE_HINT = "Letters, numbers, hyphens and underscores. Saved in capitals.";

/** The backend trims and upper-cases codes (subject.schema.ts). */
export const normaliseSubjectCode = (code: string) => code.trim().toUpperCase();

export function codeProblem(code: string): string | null {
  if (code.length === 0) return "Enter a code";
  if (code.length > 20) return "Use at most 20 characters";
  if (!CODE_PATTERN.test(code)) return "Start with a letter or number; use only letters, numbers, - and _";
  return null;
}

/**
 * A code suggested from a subject name, so the administrator does not have to invent one:
 *  - several words: their initials ("Computer Science" -> CS, "Physical Education" -> PE);
 *  - one word: its first three characters ("Hindi" -> HIN, "maths" -> MAT); short words are kept whole ("SST", "PE");
 *  - if the code is taken (by another row or an existing subject), a number is added (MAT, MAT2, MAT3, ...).
 * Only letters and digits are used, so the result always passes codeProblem(). Empty when the name has none.
 */
export function suggestSubjectCode(name: string, taken: ReadonlySet<string> = new Set()): string {
  const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return "";
  const base = (words.length > 1 ? words.map((w) => w[0]).join("") : words[0]!.slice(0, 3)).slice(0, 16);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Single create/edit form (mirrors createSubjectSchema). */
export const subjectFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters"),
  code: z
    .string()
    .transform(normaliseSubjectCode)
    .superRefine((code, ctx) => {
      const problem = codeProblem(code);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});
export type SubjectFormInput = z.input<typeof subjectFormSchema>;
export type SubjectFormValues = z.output<typeof subjectFormSchema>;

// ------------------------------------------------------------------ "Add several"

export interface SubjectRow {
  key: string;
  name: string;
  code: string;
}

const isBlank = (row: SubjectRow) => row.name.trim() === "" && row.code.trim() === "";

/**
 * Builds POST /subjects/bulk rows, skipping completely blank rows. `rowKeys[i]` is the editor row that
 * produced `subjects[i]`, so "subjects.i.code" errors map back to the right row.
 */
export function buildSubjectsPayload(rows: readonly SubjectRow[]): { subjects: CreateSubjectBody[]; rowKeys: string[] } {
  const kept = rows.filter((row) => !isBlank(row));
  return {
    subjects: kept.map((row) => ({ name: row.name.trim(), code: normaliseSubjectCode(row.code) })),
    rowKeys: kept.map((row) => row.key),
  };
}

/** Client checks keyed like the backend ("subjects.N.field"), including duplicates inside the request. */
export function validateSubjectsPayload(subjects: readonly CreateSubjectBody[]): PathErrors {
  const errors: PathErrors = {};
  if (subjects.length === 0) errors.subjects = "Fill in at least one subject";
  if (subjects.length > MAX_BULK_SUBJECTS) errors.subjects = `At most ${MAX_BULK_SUBJECTS} subjects can be added at once`;
  const seen = new Map<string, number>();
  subjects.forEach((s, i) => {
    if (s.name.length === 0) errors[`subjects.${i}.name`] = "Enter a name";
    else if (s.name.length > 100) errors[`subjects.${i}.name`] = "Use at most 100 characters";
    const problem = codeProblem(s.code);
    if (problem) errors[`subjects.${i}.code`] = problem;
    else if (seen.has(s.code)) errors[`subjects.${i}.code`] = `Code ${s.code} is repeated in this list`;
    else seen.set(s.code, i);
  });
  return errors;
}

/** Re-keys "subjects.N.field" messages to editor rows: { rowKey: { name?, code? } }. Other paths are returned as leftovers. */
export function rowErrorsFromPaths(byPath: PathErrors, rowKeys: readonly string[]): { rows: Record<string, Partial<Record<"name" | "code", string>>>; leftovers: string[] } {
  const rows: Record<string, Partial<Record<"name" | "code", string>>> = {};
  const leftovers: string[] = [];
  for (const [path, message] of Object.entries(byPath)) {
    const match = /^subjects\.(\d+)\.(name|code)$/.exec(path);
    const key = match ? rowKeys[Number(match[1])] : undefined;
    if (match && key) (rows[key] ??= {})[match[2] as "name" | "code"] = message;
    else leftovers.push(message);
  }
  return { rows, leftovers };
}

// ------------------------------------------------------------------ usage in the selected year

export interface SubjectGradeUsage {
  gradeId: string;
  gradeName: string;
  displayOrder: number;
  lines: Array<{ streamName: string | null; periodsPerWeek: number; isOptional: boolean }>;
}

export function subjectUsage(overview: CurriculumOverview | undefined, subjectId: string): SubjectGradeUsage[] {
  const entry = overview?.subjects.find((s) => s.subject.id === subjectId);
  if (!overview || !entry) return [];
  const byGrade = new Map<string, SubjectGradeUsage>();
  for (const use of entry.usage) {
    const grade = overview.grades.find((g) => g.id === use.gradeId);
    if (!grade) continue;
    const row = byGrade.get(grade.id) ?? { gradeId: grade.id, gradeName: grade.name, displayOrder: grade.displayOrder, lines: [] };
    const stream = use.streamId ? grade.streams.find((s) => s.id === use.streamId) : null;
    row.lines.push({ streamName: stream?.name ?? null, periodsPerWeek: use.periodsPerWeek, isOptional: use.isOptional });
    byGrade.set(grade.id, row);
  }
  return [...byGrade.values()]
    .map((g) => ({ ...g, lines: [...g.lines].sort((a, b) => (a.streamName ?? "").localeCompare(b.streamName ?? "")) }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/** gradeCount per subject id, from the overview. */
export function gradeCounts(overview: CurriculumOverview | undefined): Map<string, number> {
  return new Map((overview?.subjects ?? []).map((s) => [s.subject.id, s.gradeCount]));
}
