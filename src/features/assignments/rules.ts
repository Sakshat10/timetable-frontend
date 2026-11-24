import { isApiError } from "@/lib/api/errors";
import type { CurriculumOverview } from "@/lib/api/schemas";
import type { GradeEligibility, SectionAssignment, TeacherListItem, TeacherSubjectLink } from "@/lib/api/types";
import { isEligibleForGrade } from "@/features/teachers/rules";

// ------------------------------------------------------------------ grid model (from GET /curriculum)

export interface GridSection {
  id: string;
  name: string;
}

export interface GridRequirement {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  periodsPerWeek: number;
  /** The section ids this requirement applies to (its scope). */
  sectionIds: ReadonlySet<string>;
}

export interface GridGroup {
  key: string;
  gradeId: string;
  gradeName: string;
  streamName: string | null;
  label: string;
  sections: GridSection[];
  requirements: GridRequirement[];
}

/** One block per grade/stream curriculum, in grade display order. */
export function buildGrid(overview: Pick<CurriculumOverview, "grades"> | undefined): GridGroup[] {
  if (!overview) return [];
  return [...overview.grades]
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .flatMap((grade) =>
      grade.curricula.map((group) => {
        const allIds = group.sections.map((s) => s.id);
        return {
          key: `${grade.id}:${group.streamId ?? "none"}`,
          gradeId: grade.id,
          gradeName: grade.name,
          streamName: group.stream?.name ?? null,
          label: group.label,
          sections: group.sections.map((s) => ({ id: s.id, name: s.name })),
          requirements: [...group.requirements]
            .sort((a, b) => a.subject.name.localeCompare(b.subject.name))
            .map((r) => ({
              id: r.id,
              subjectId: r.subject.id,
              subjectName: r.subject.name,
              subjectCode: r.subject.code,
              periodsPerWeek: r.periodsPerWeek,
              sectionIds: new Set(r.sectionScope === "ALL_SECTIONS" ? allIds : r.sectionIds.filter((id) => allIds.includes(id))),
            })),
        };
      }),
    );
}

export const pinKey = (sectionId: string, requirementId: string) => `${sectionId}:${requirementId}`;

export function indexPins(pins: readonly SectionAssignment[] | undefined): Map<string, SectionAssignment> {
  return new Map((pins ?? []).map((pin) => [pinKey(pin.sectionId, pin.subjectRequirementId), pin]));
}

export interface GridFilters {
  gradeId: string | null;
  subjectId: string | null;
  teacherId: string | null;
  pinnedOnly: boolean;
}

/** Applies the filters: whole groups by grade, requirement rows by subject / teacher / pinned-only. */
export function filterGrid(groups: readonly GridGroup[], pins: ReadonlyMap<string, SectionAssignment>, filters: GridFilters): GridGroup[] {
  return groups
    .filter((g) => !filters.gradeId || g.gradeId === filters.gradeId)
    .map((g) => ({
      ...g,
      requirements: g.requirements.filter((r) => {
        if (filters.subjectId && r.subjectId !== filters.subjectId) return false;
        const rowPins = g.sections.map((s) => pins.get(pinKey(s.id, r.id))).filter((p): p is SectionAssignment => Boolean(p));
        if (filters.teacherId && !rowPins.some((p) => p.teacherId === filters.teacherId)) return false;
        if (filters.pinnedOnly && rowPins.length === 0) return false;
        return true;
      }),
    }))
    .filter((g) => g.requirements.length > 0);
}

/** Counts of applicable cells and pins (shown as context; not a teacher total). */
export function pinCounts(groups: readonly GridGroup[], pins: ReadonlyMap<string, SectionAssignment>) {
  let cells = 0;
  let pinned = 0;
  for (const g of groups)
    for (const r of g.requirements)
      for (const s of g.sections)
        if (r.sectionIds.has(s.id)) {
          cells++;
          if (pins.has(pinKey(s.id, r.id))) pinned++;
        }
  return { cells, pinned };
}

// ------------------------------------------------------------------ candidates (advisory; the server is authoritative)

export type CandidateStatus = "eligible" | "inactive" | "not-eligible" | "loading";

export interface Candidate {
  teacher: Pick<TeacherListItem, "id" | "name" | "employeeCode" | "isActive">;
  status: CandidateStatus;
  reason: string | null;
}

/**
 * Teachers who could be pinned to (grade, subject) in this year: active, linked to the subject, and grade-eligible
 * (ALL_GRADES, or a SELECTED_GRADES link with an eligibility row for this grade in THIS year). Teachers not linked to the
 * subject are left out; linked-but-ineligible ones are returned with a reason so the picker can show them disabled.
 */
export function buildCandidates(args: {
  teachers: readonly TeacherListItem[];
  linksByTeacher: ReadonlyMap<string, readonly TeacherSubjectLink[] | undefined>;
  gradesByLink: ReadonlyMap<string, readonly GradeEligibility[] | undefined>;
  subjectId: string;
  gradeId: string;
  gradeName: string;
  yearId: string;
}): Candidate[] {
  const { teachers, linksByTeacher, gradesByLink, subjectId, gradeId, gradeName, yearId } = args;
  const order: Record<CandidateStatus, number> = { eligible: 0, loading: 1, "not-eligible": 2, inactive: 3 };
  return teachers
    .filter((t) => t.subjects.some((s) => s.id === subjectId))
    .map((teacher): Candidate => {
      if (!teacher.isActive) return { teacher, status: "inactive", reason: "Inactive" };
      const links = linksByTeacher.get(teacher.id);
      if (!links) return { teacher, status: "loading", reason: "Checking eligibility…" };
      const link = links.find((l) => l.subjectId === subjectId);
      if (!link) return { teacher, status: "not-eligible", reason: "Not qualified for this subject" };
      if (link.gradeScope === "ALL_GRADES") return { teacher, status: "eligible", reason: null };
      const rows = gradesByLink.get(link.id);
      if (!rows) return { teacher, status: "loading", reason: "Checking eligibility…" };
      return isEligibleForGrade(link, rows, gradeId, yearId)
        ? { teacher, status: "eligible", reason: null }
        : { teacher, status: "not-eligible", reason: `Not eligible for ${gradeName}` };
    })
    .sort((a, b) => order[a.status] - order[b.status] || a.teacher.name.localeCompare(b.teacher.name));
}

/** A user-facing explanation for a refused pin (400/409 from section-subject-teachers). */
export function pinErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Something went wrong. Please try again.";
  const message = error.message;
  if (error.status === 409) return "This class already has a pinned teacher for this subject. The grid has been refreshed.";
  if (error.status === 400) {
    if (/inactive/i.test(message)) return "This teacher is inactive and can’t be pinned. Reactivate them on the Teachers page first.";
    if (/not assigned to teach this subject/i.test(message)) return "This teacher isn’t qualified for this subject. Add the subject on the teacher’s page first.";
    if (/not eligible/i.test(message)) return "This teacher isn’t eligible for this grade in this year. Tick the grade on the teacher’s page first.";
    if (/scope|section/i.test(message)) return `This class isn’t covered by the subject requirement: ${message}`;
  }
  return message;
}
