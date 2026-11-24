/**
 * Pure rules for the Curriculum page (PHASE-0-AUDIT §1.5): editor lines ↔ PUT /curriculum/grades/:id body,
 * row-keyed validation, plan summaries for the dry-run review, labels and demand status.
 */
import type { CurriculumLineBody, ReplaceCurriculumBody, SectionScope } from "@/lib/api/types";
import type { CopyCurriculumResult, CurriculumGrade, CurriculumGroup, CurriculumOverview, CurriculumRequirement, ReplaceCurriculumResult } from "@/lib/api/schemas";
import type { PathErrors } from "./form-errors";

export const MAX_CURRICULUM_SUBJECTS = 60;
export const PERIODS_MIN = 1;
export const PERIODS_MAX = 40;

export const CLASSIFICATION_LABEL: Record<CurriculumRequirement["classification"], string> = {
  COMMON: "Common",
  GRADE_SPECIFIC: "This grade only",
  STREAM_SPECIFIC: "Stream-specific",
  SECTION_SPECIFIC: "Selected sections",
};
export const CLASSIFICATION_HINT: Record<CurriculumRequirement["classification"], string> = {
  COMMON: "Taught in more than one grade",
  GRADE_SPECIFIC: "Taught only in this grade",
  STREAM_SPECIFIC: "Not every stream of the grade has it",
  SECTION_SPECIFIC: "Only some sections have it",
};

export interface EditorLine {
  key: string;
  subjectId: string;
  /** As typed. */
  periodsPerWeek: string;
  isOptional: boolean;
  sectionScope: SectionScope;
  sectionIds: string[];
}

let seq = 0;
export const lineKey = () => `line-${++seq}`;

export function emptyLine(): EditorLine {
  return { key: lineKey(), subjectId: "", periodsPerWeek: "", isOptional: false, sectionScope: "ALL_SECTIONS", sectionIds: [] };
}

export function linesFromGroup(group: CurriculumGroup): EditorLine[] {
  return group.requirements.map((r) => ({
    key: lineKey(),
    subjectId: r.subject.id,
    periodsPerWeek: String(r.periodsPerWeek),
    isOptional: r.isOptional,
    sectionScope: r.sectionScope,
    sectionIds: r.sectionScope === "SELECTED_SECTIONS" ? [...r.sectionIds] : [],
  }));
}

/** Strict integer parse ("5" → 5; "5.5", "", "5x" → NaN). The backend rejects non-integers and strings. */
export function parsePeriods(value: string): number {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** The COMPLETE curriculum of a grade/stream. Lines keep their positions so "requirements.N.*" errors map back. */
export function buildReplaceBody(streamId: string | null, lines: readonly EditorLine[], dryRun: boolean): ReplaceCurriculumBody {
  return {
    ...(streamId ? { streamId } : {}),
    dryRun,
    requirements: lines.map((line): CurriculumLineBody => ({
      subjectId: line.subjectId,
      periodsPerWeek: parsePeriods(line.periodsPerWeek),
      isOptional: line.isOptional,
      sectionScope: line.sectionScope,
      ...(line.sectionScope === "SELECTED_SECTIONS" ? { sectionIds: [...line.sectionIds] } : {}),
    })),
  };
}

export function lineErrorPaths(lines: readonly EditorLine[]): Set<string> {
  const paths = new Set<string>(["requirements"]);
  lines.forEach((_, i) => ["subjectId", "periodsPerWeek", "isOptional", "sectionScope", "sectionIds"].forEach((f) => paths.add(`requirements.${i}.${f}`)));
  return paths;
}

/** Client checks mirroring curriculum.schema.ts, keyed like the backend. */
export function validateLines(lines: readonly EditorLine[], groupSectionIds: readonly string[]): PathErrors {
  const errors: PathErrors = {};
  if (lines.length > MAX_CURRICULUM_SUBJECTS) errors.requirements = `At most ${MAX_CURRICULUM_SUBJECTS} subjects per curriculum`;
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    const p = `requirements.${i}`;
    if (!line.subjectId) errors[`${p}.subjectId`] = "Choose a subject";
    else if (seen.has(line.subjectId)) errors[`${p}.subjectId`] = `This subject is already listed (row ${seen.get(line.subjectId)! + 1})`;
    else seen.set(line.subjectId, i);
    const periods = parsePeriods(line.periodsPerWeek);
    if (line.periodsPerWeek.trim() === "") errors[`${p}.periodsPerWeek`] = "Enter periods per week";
    else if (!Number.isInteger(periods) || periods < PERIODS_MIN || periods > PERIODS_MAX)
      errors[`${p}.periodsPerWeek`] = `Use a whole number from ${PERIODS_MIN} to ${PERIODS_MAX}`;
    if (line.sectionScope === "SELECTED_SECTIONS") {
      const valid = line.sectionIds.filter((id) => groupSectionIds.includes(id));
      if (valid.length === 0) errors[`${p}.sectionIds`] = "Choose at least one section";
    }
  });
  return errors;
}

/** Total weekly periods of the lines that are valid numbers (for the live total in the editor). */
export function linesTotal(lines: readonly EditorLine[]): number {
  return lines.reduce((n, l) => {
    const p = parsePeriods(l.periodsPerWeek);
    return Number.isFinite(p) ? n + p : n;
  }, 0);
}

/** Per-section weekly demand for editor lines (ALL_SECTIONS lines apply to every section). */
export function sectionDemandFromLines(lines: readonly EditorLine[], sectionIds: readonly string[]): Map<string, number> {
  const demand = new Map(sectionIds.map((id) => [id, 0]));
  for (const line of lines) {
    const p = parsePeriods(line.periodsPerWeek);
    if (!Number.isFinite(p)) continue;
    for (const id of sectionIds) {
      if (line.sectionScope === "ALL_SECTIONS" || line.sectionIds.includes(id)) demand.set(id, (demand.get(id) ?? 0) + p);
    }
  }
  return demand;
}

// ------------------------------------------------------------------ dry-run plan

const CHANGE_LABEL: Record<string, string> = { periodsPerWeek: "periods per week", isOptional: "optional label", sections: "sections" };
export const describeChanges = (changes: readonly string[]) => changes.map((c) => CHANGE_LABEL[c] ?? c).join(", ");

export interface PlanSummary {
  create: number;
  update: number;
  remove: number;
  unchanged: number;
  hasChanges: boolean;
  sentence: string;
}

export function summarisePlan(plan: ReplaceCurriculumResult["plan"]): PlanSummary {
  const create = plan.create.length;
  const update = plan.update.length;
  const remove = plan.remove.length;
  const parts = [create && `add ${create}`, update && `change ${update}`, remove && `remove ${remove}`].filter(Boolean) as string[];
  const hasChanges = parts.length > 0;
  const subjects = (n: number) => (n === 1 ? "subject" : "subjects");
  const total = create + update + remove;
  return {
    create,
    update,
    remove,
    unchanged: plan.unchanged,
    hasChanges,
    sentence: hasChanges
      ? `This will ${joinWords(parts)} ${subjects(total)}${plan.unchanged ? `; ${plan.unchanged} stay${plan.unchanged === 1 ? "s" : ""} as they are` : ""}.`
      : "Nothing would change: the curriculum already matches.",
  };
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Reads the optional from/to values of an update line (present in the backend plan, not in its schema). */
export function updateDetail(update: ReplaceCurriculumResult["plan"]["update"][number]): { fromPeriods?: number; toPeriods?: number; toOptional?: boolean } {
  const from = (update as { from?: { periodsPerWeek?: unknown } }).from;
  const to = (update as { to?: { periodsPerWeek?: unknown; isOptional?: unknown } }).to;
  return {
    fromPeriods: typeof from?.periodsPerWeek === "number" ? from.periodsPerWeek : undefined,
    toPeriods: typeof to?.periodsPerWeek === "number" ? to.periodsPerWeek : undefined,
    toOptional: typeof to?.isOptional === "boolean" ? to.isOptional : undefined,
  };
}

export const COPY_SKIP_REASON: Record<CopyCurriculumResult["skipped"][number]["reason"], string> = {
  ALREADY_REQUIRED: "Already in this curriculum (kept as it is)",
  SECTION_SPECIFIC_NOT_COPIED: "Limited to selected sections in the source, so not copied",
};

// ------------------------------------------------------------------ groups, sources, demand

export interface GroupRef {
  gradeId: string;
  streamId: string | null;
}
export const groupId = (ref: GroupRef) => `${ref.gradeId}:${ref.streamId ?? "-"}`;

export interface GroupOption extends GroupRef {
  id: string;
  label: string;
  subjectCount: number;
}

/** Grade/stream curricula that can be copied into `target` (any other group of the year that has subjects). */
export function copySources(overview: CurriculumOverview, target: GroupRef): GroupOption[] {
  const out: GroupOption[] = [];
  for (const grade of [...overview.grades].sort((a, b) => a.displayOrder - b.displayOrder)) {
    for (const group of grade.curricula) {
      const ref = { gradeId: grade.id, streamId: group.streamId };
      if (groupId(ref) === groupId(target) || group.requirements.length === 0) continue;
      out.push({ ...ref, id: groupId(ref), label: group.label, subjectCount: group.requirements.length });
    }
  }
  return out;
}

export type DemandStatus = "unknown" | "over" | "exact" | "under";
export function demandStatus(demand: number, weeklySlots: number | null): DemandStatus {
  if (weeklySlots === null) return "unknown";
  if (demand > weeklySlots) return "over";
  if (demand === weeklySlots) return "exact";
  return "under";
}

export function findGroup(overview: CurriculumOverview | undefined, ref: GroupRef): { grade: CurriculumGrade; group: CurriculumGroup } | null {
  const grade = overview?.grades.find((g) => g.id === ref.gradeId);
  const group = grade?.curricula.find((c) => c.streamId === ref.streamId);
  return grade && group ? { grade, group } : null;
}

export function issuesFor(overview: CurriculumOverview, ref: GroupRef) {
  return overview.issues.filter((i) => i.gradeId === ref.gradeId && i.streamId === ref.streamId && i.code !== "MIXED_GRADE_MODE");
}

/** Grade-level issues (MIXED_GRADE_MODE) are shown on the grade, not on one of its groups. */
export function gradeIssues(overview: CurriculumOverview, gradeId: string) {
  return overview.issues.filter((i) => i.gradeId === gradeId && i.code === "MIXED_GRADE_MODE");
}
