/**
 * Pure rules for the Classes page: the structure tree from the curriculum overview, search, and the
 * "Add several grades" (POST /grades/bulk) payload with its row-keyed validation (PHASE-0-AUDIT §1.3).
 */
import type { BulkGradeStructureBody } from "@/lib/api/types";
import type { CurriculumGrade, CurriculumOverview } from "@/lib/api/schemas";
import { matchesQuery } from "@/components/shared/search-input";
import type { PathErrors } from "@/features/curriculum/form-errors";

/** Backend limits of one grade-structure request (grade-structure.schema.ts). */
export const STRUCTURE_LIMITS = { grades: 20, streamsPerGrade: 10, sectionsPerGrade: 30, totalSections: 200 } as const;

export type GradeMode = "empty" | "streamed" | "unstreamed" | "mixed";

function sectionSplit(grade: CurriculumGrade) {
  const unstreamed = grade.curricula.filter((g) => g.streamId === null).reduce((n, g) => n + g.sectionCount, 0);
  const streamed = grade.curricula.filter((g) => g.streamId !== null).reduce((n, g) => n + g.sectionCount, 0);
  return { unstreamed, streamed };
}

/**
 * How a grade's sections are organised. A grade is either entirely streamed or entirely unstreamed (the backend
 * refuses mixing). A grade with streams but no sections yet is "streamed"; one with neither is "empty". "mixed"
 * only describes legacy data the backend reports as MIXED_GRADE_MODE (or streams next to unstreamed sections).
 */
export function gradeMode(grade: CurriculumGrade): GradeMode {
  const { unstreamed, streamed } = sectionSplit(grade);
  if (unstreamed > 0 && streamed > 0) return "mixed";
  if (streamed > 0) return "streamed";
  if (unstreamed > 0) return grade.streams.length > 0 ? "mixed" : "unstreamed";
  return grade.streams.length > 0 ? "streamed" : "empty";
}

/** A stream can be added unless the grade already has sections without a stream (that would mix modes). */
export function canAddStream(grade: CurriculumGrade): boolean {
  return sectionSplit(grade).unstreamed === 0;
}

/**
 * Whether a new section must name a stream. Mirrors the backend: once a grade has streamed sections every new
 * section needs a stream; once it has unstreamed sections none may have one; an empty grade follows its streams.
 */
export function sectionNeedsStream(grade: CurriculumGrade): boolean {
  const { unstreamed, streamed } = sectionSplit(grade);
  if (streamed > 0) return true;
  if (unstreamed > 0) return false;
  return grade.streams.length > 0;
}

export function sortGrades<T extends { displayOrder: number; name: string }>(grades: readonly T[]): T[] {
  return [...grades].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
}

/** A grade matches when its name, or any of its streams or sections (name or code), matches. */
export function filterGrades(grades: readonly CurriculumGrade[], query: string): CurriculumGrade[] {
  if (!query.trim()) return [...grades];
  return grades.filter(
    (g) =>
      matchesQuery(query, g.name) ||
      g.streams.some((s) => matchesQuery(query, s.name, s.code)) ||
      g.curricula.some((c) => c.sections.some((s) => matchesQuery(query, s.name, s.code))),
  );
}

/** The next free display order (max + 1). */
export function nextDisplayOrder(grades: ReadonlyArray<{ displayOrder: number }>): number {
  return grades.reduce((max, g) => Math.max(max, g.displayOrder), 0) + 1;
}

export function structureTotals(overview: CurriculumOverview) {
  return {
    grades: overview.grades.length,
    streams: overview.grades.reduce((n, g) => n + g.streams.length, 0),
    sections: overview.grades.reduce((n, g) => n + g.sectionCount, 0),
  };
}

// ------------------------------------------------------------------ "Add several grades"

export interface StructureStreamRow {
  key: string;
  name: string;
  code: string;
}
export interface StructureSectionRow {
  key: string;
  name: string;
  code: string;
  /** Code of one of this grade's streams (only when the grade uses streams). */
  streamCode: string;
}
export interface StructureGradeRow {
  key: string;
  name: string;
  /** As typed. */
  displayOrder: string;
  useStreams: boolean;
  streams: StructureStreamRow[];
  sections: StructureSectionRow[];
}

/**
 * Builds the request body. Rows keep their positions so the backend's row-keyed errors
 * ("grades.0.sections.1.code") point straight back at the inputs.
 */
export function buildStructurePayload(academicYearId: string, rows: readonly StructureGradeRow[]): BulkGradeStructureBody {
  return {
    academicYearId,
    grades: rows.map((row) => ({
      name: row.name.trim(),
      displayOrder: row.displayOrder.trim() === "" ? Number.NaN : Number(row.displayOrder),
      ...(row.useStreams ? { streams: row.streams.map((s) => ({ name: s.name.trim(), code: s.code.trim() })) } : {}),
      sections: row.sections.map((s) => ({
        name: s.name.trim(),
        code: s.code.trim(),
        ...(row.useStreams ? { streamCode: s.streamCode.trim() } : {}),
      })),
    })),
  };
}

/** Every input path the bulk dialog renders, for matching server errors. */
export function structurePaths(rows: readonly StructureGradeRow[]): Set<string> {
  const paths = new Set<string>(["grades"]);
  rows.forEach((row, i) => {
    const base = `grades.${i}`;
    paths.add(base).add(`${base}.name`).add(`${base}.displayOrder`).add(`${base}.streams`).add(`${base}.sections`);
    row.streams.forEach((_, j) => paths.add(`${base}.streams.${j}`).add(`${base}.streams.${j}.name`).add(`${base}.streams.${j}.code`));
    row.sections.forEach((_, j) =>
      paths.add(`${base}.sections.${j}`).add(`${base}.sections.${j}.name`).add(`${base}.sections.${j}.code`).add(`${base}.sections.${j}.streamCode`),
    );
  });
  return paths;
}

const lengthError = (value: string, label: string, max: number): string | null =>
  value.length === 0 ? `${label} is required` : value.length > max ? `${label} must not exceed ${max} characters` : null;

/**
 * Client-side checks that mirror grade-structure.schema.ts and grade-structure.service.ts, keyed by the same
 * paths the backend uses. `existing` are the year's current grades (name and display order must be unique).
 */
export function validateStructure(
  body: BulkGradeStructureBody,
  existing: ReadonlyArray<{ name: string; displayOrder: number }> = [],
): PathErrors {
  const errors: PathErrors = {};
  const add = (path: string, message: string) => {
    errors[path] ??= message;
  };
  if (body.grades.length === 0) add("grades", "Add at least one grade");
  if (body.grades.length > STRUCTURE_LIMITS.grades) add("grades", `At most ${STRUCTURE_LIMITS.grades} grades can be created at once`);
  const totalSections = body.grades.reduce((n, g) => n + (g.sections?.length ?? 0), 0);
  if (totalSections > STRUCTURE_LIMITS.totalSections) add("grades", `At most ${STRUCTURE_LIMITS.totalSections} sections can be created at once`);

  const existingNames = new Set(existing.map((g) => g.name.trim()));
  const existingOrders = new Set(existing.map((g) => g.displayOrder));
  const namesSeen = new Map<string, number>();
  const ordersSeen = new Map<number, number>();

  body.grades.forEach((grade, i) => {
    const base = `grades.${i}`;
    const nameError = lengthError(grade.name, "Grade name", 100);
    if (nameError) add(`${base}.name`, nameError);
    else if (existingNames.has(grade.name)) add(`${base}.name`, `Grade "${grade.name}" already exists in this academic year`);
    else if (namesSeen.has(grade.name)) add(`${base}.name`, `Same name as grade ${namesSeen.get(grade.name)! + 1} in this list`);
    else namesSeen.set(grade.name, i);

    if (!Number.isInteger(grade.displayOrder) || grade.displayOrder < 1) add(`${base}.displayOrder`, "Display order must be a whole number of 1 or more");
    else if (existingOrders.has(grade.displayOrder)) add(`${base}.displayOrder`, `Display order ${grade.displayOrder} is already used in this academic year`);
    else if (ordersSeen.has(grade.displayOrder)) add(`${base}.displayOrder`, `Same display order as grade ${ordersSeen.get(grade.displayOrder)! + 1} in this list`);
    else ordersSeen.set(grade.displayOrder, i);

    const streams = grade.streams;
    const sections = grade.sections ?? [];
    if (streams !== undefined) {
      if (streams.length === 0) add(`${base}.streams`, "Add at least one stream, or turn off streams for this grade");
      if (streams.length > STRUCTURE_LIMITS.streamsPerGrade) add(`${base}.streams`, `At most ${STRUCTURE_LIMITS.streamsPerGrade} streams per grade`);
      const codes = new Map<string, number>();
      const names = new Map<string, number>();
      streams.forEach((s, j) => {
        const sp = `${base}.streams.${j}`;
        const n = lengthError(s.name, "Stream name", 100);
        if (n) add(`${sp}.name`, n);
        else if (names.has(s.name.toLowerCase())) add(`${sp}.name`, "Two streams of this grade have the same name");
        else names.set(s.name.toLowerCase(), j);
        const c = lengthError(s.code, "Stream code", 20);
        if (c) add(`${sp}.code`, c);
        else if (codes.has(s.code.toUpperCase())) add(`${sp}.code`, "Two streams of this grade have the same code");
        else codes.set(s.code.toUpperCase(), j);
      });
      if (streams.length > 0 && sections.length > 0 && !sections.some((s) => s.streamCode)) {
        add(`${base}.streams`, "Streams are declared but no section uses one");
      }
    }
    if (sections.length > STRUCTURE_LIMITS.sectionsPerGrade) add(`${base}.sections`, `At most ${STRUCTURE_LIMITS.sectionsPerGrade} sections per grade`);
    const declared = new Set((streams ?? []).map((s) => s.code.toUpperCase()).filter(Boolean));
    const sectionCodes = new Set<string>();
    sections.forEach((s, j) => {
      const sp = `${base}.sections.${j}`;
      const n = lengthError(s.name, "Section name", 100);
      if (n) add(`${sp}.name`, n);
      const c = lengthError(s.code, "Section code", 20);
      if (c) add(`${sp}.code`, c);
      if (streams !== undefined) {
        if (!s.streamCode) add(`${sp}.streamCode`, "Choose the section’s stream");
        else if (!declared.has(s.streamCode.toUpperCase())) add(`${sp}.streamCode`, `Stream "${s.streamCode}" is not one of this grade’s streams`);
      }
      if (!c) {
        const key = `${(s.streamCode ?? "").toUpperCase()}|${s.code}`;
        if (sectionCodes.has(key)) add(`${sp}.code`, "Two sections of this grade (and stream) have the same code");
        sectionCodes.add(key);
      }
    });
  });
  return errors;
}

let keySeq = 0;
/** A stable key for a new editor row. */
export const rowKey = (prefix: string) => `${prefix}-${++keySeq}`;

export function emptyGradeRow(displayOrder: number): StructureGradeRow {
  return { key: rowKey("g"), name: "", displayOrder: String(displayOrder), useStreams: false, streams: [], sections: [] };
}
