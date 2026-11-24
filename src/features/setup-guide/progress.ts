/**
 * Setup progress derived ONLY from saved backend data (no onboarding storage of its own): the dashboard
 * and the Setup guide both use it. Each step says what the backend shows, what is missing and where to fix it.
 */
import type { CurriculumOverview } from "@/lib/api/schemas";
import type { Feasibility, ScheduleConfig, Subject, TeacherListItem, VersionSummary, SectionAssignment, AcademicYearStatus } from "@/lib/api/types";

export type StepState = "done" | "todo" | "attention" | "optional" | "locked" | "unknown";

export interface SetupStep {
  id: "schedule" | "classes" | "subjects" | "curriculum" | "teachers" | "eligibility" | "assignments" | "readiness" | "timetable";
  title: string;
  description: string;
  state: StepState;
  /** One line about what the backend data shows. */
  detail: string;
  /** Path relative to /years/[yearId] (or absolute when it starts with "/operations"). */
  href: string;
  cta: string;
}

export interface ProgressInput {
  yearStatus: AcademicYearStatus;
  schedule?: ScheduleConfig[] | undefined;
  curriculum?: CurriculumOverview | undefined;
  subjects?: Subject[] | undefined;
  teachers?: TeacherListItem[] | undefined;
  assignments?: SectionAssignment[] | undefined;
  feasibility?: Feasibility | undefined;
  versions?: VersionSummary[] | undefined;
}

const ELIGIBILITY_CODES = new Set(["NO_ELIGIBLE_TEACHER", "ELIGIBLE_TEACHER_CAPACITY_INSUFFICIENT", "TEACHER_ALLOCATION_FAILED", "ASSIGNED_TEACHER_NOT_ELIGIBLE"]);
const CURRICULUM_CODES = new Set(["NO_SUBJECT_REQUIREMENTS", "SECTION_CAPACITY_EXCEEDED", "REQUIREMENT_EXCEEDS_TEACHER_CAPACITY"]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function computeSetupSteps(input: ProgressInput): SetupStep[] {
  const { schedule, curriculum, subjects, teachers, assignments, feasibility, versions } = input;
  const errorCodes = new Set((feasibility?.errors ?? []).map((issue) => issue.code));
  const sections = curriculum?.grades.reduce((n, g) => n + g.sectionCount, 0);
  const grades = curriculum?.grades.length;
  const requirements = curriculum?.grades.reduce((n, g) => n + g.curricula.reduce((m, c) => m + c.requirements.length, 0), 0);
  const groupsWithout = curriculum?.issues.filter((i) => i.code === "GROUP_WITHOUT_CURRICULUM").length ?? 0;
  const activeTeachers = teachers?.filter((t) => t.isActive);
  const linkedTeachers = activeTeachers?.filter((t) => t.subjects.length > 0);
  const config = schedule?.[0];
  const published = versions?.find((v) => v.status === "PUBLISHED");
  const drafts = versions?.filter((v) => v.status === "DRAFT") ?? [];

  const steps: SetupStep[] = [
    {
      id: "schedule",
      title: "Weekly schedule",
      description: "Working days, periods per day and where the break falls.",
      state: !schedule ? "unknown" : !config ? "todo" : config.legacy ? "attention" : "done",
      detail: !schedule
        ? "Couldn’t check the schedule."
        : !config
          ? "No schedule yet."
          : config.legacy
            ? "Made before the simplified schedule: set the break position."
            : `${config.workingDays.length} days × ${config.periodsPerDay} periods, break after period ${config.breakAfterPeriod} (${config.weeklyTeachingCapacity} teaching periods a week).`,
      href: "/schedule",
      cta: config ? "Review schedule" : "Set up schedule",
    },
    {
      id: "classes",
      title: "Classes and sections",
      description: "Grades, optional streams and the sections that get a timetable.",
      state: sections === undefined ? "unknown" : sections > 0 ? "done" : "todo",
      detail: sections === undefined ? "Couldn’t check the classes." : sections > 0 ? `${plural(grades ?? 0, "grade")}, ${plural(sections, "section")}.` : "No sections yet.",
      href: "/classes",
      cta: sections ? "Manage classes" : "Add classes",
    },
    {
      id: "subjects",
      title: "Subjects",
      description: "The school’s subject list, shared by every academic year.",
      state: !subjects ? "unknown" : subjects.length > 0 ? "done" : "todo",
      detail: !subjects ? "Couldn’t check the subjects." : subjects.length > 0 ? `${plural(subjects.length, "subject")}.` : "No subjects yet.",
      href: "/subjects",
      cta: subjects?.length ? "Manage subjects" : "Add subjects",
    },
    {
      id: "curriculum",
      title: "Curriculum",
      description: "Which subjects each grade studies and how many periods a week.",
      state:
        requirements === undefined
          ? "unknown"
          : requirements === 0
            ? "todo"
            : groupsWithout > 0 || [...errorCodes].some((c) => CURRICULUM_CODES.has(c))
              ? "attention"
              : "done",
      detail:
        requirements === undefined
          ? "Couldn’t check the curriculum."
          : requirements === 0
            ? "No subject requirements yet."
            : groupsWithout > 0
              ? `${plural(groupsWithout, "grade or stream")} without a curriculum.`
              : `${plural(requirements, "subject requirement")}.`,
      href: "/curriculum",
      cta: "Edit curriculum",
    },
    {
      id: "teachers",
      title: "Teachers",
      description: "Teachers and the subjects they can teach.",
      state: !activeTeachers ? "unknown" : activeTeachers.length === 0 ? "todo" : (linkedTeachers?.length ?? 0) === 0 ? "attention" : "done",
      detail: !activeTeachers
        ? "Couldn’t check the teachers."
        : activeTeachers.length === 0
          ? "No active teachers yet."
          : `${plural(activeTeachers.length, "active teacher")}, ${linkedTeachers?.length ?? 0} with subjects.`,
      href: "/teachers",
      cta: activeTeachers?.length ? "Manage teachers" : "Add teachers",
    },
    {
      id: "eligibility",
      title: "Teacher eligibility",
      description: "Which grades each teacher may teach their subjects to this year. The generator picks only eligible teachers.",
      state: !feasibility ? "unknown" : [...errorCodes].some((c) => ELIGIBILITY_CODES.has(c)) ? "attention" : (linkedTeachers?.length ?? 0) > 0 ? "done" : "todo",
      detail: !feasibility
        ? "Run the readiness check to see eligibility gaps."
        : [...errorCodes].some((c) => ELIGIBILITY_CODES.has(c))
          ? "Some subjects have no eligible teacher, or not enough capacity."
          : "Every required subject has an eligible teacher.",
      href: "/teachers",
      cta: "Review eligibility",
    },
    {
      id: "assignments",
      title: "Specific teacher assignments",
      description: "Optional: pin a teacher to a class and subject. Unpinned subjects get an eligible teacher automatically at generation.",
      state: "optional",
      detail: assignments ? (assignments.length > 0 ? `${plural(assignments.length, "pinned assignment")}.` : "None pinned. The generator chooses eligible teachers.") : "Optional.",
      href: "/assignments",
      cta: "Review assignments",
    },
    {
      id: "readiness",
      title: "Readiness review",
      description: "Pre-generation checks across the whole setup.",
      state: !feasibility ? "unknown" : feasibility.status === "READY" ? "done" : "attention",
      detail: !feasibility
        ? "Couldn’t run the readiness check."
        : feasibility.status === "READY"
          ? `Ready for generation${feasibility.summary.warningCount ? ` (${plural(feasibility.summary.warningCount, "warning")})` : ""}.`
          : `${plural(feasibility.summary.errorCount, "blocking issue")} to fix.`,
      href: "/generate",
      cta: "Open readiness",
    },
    {
      id: "timetable",
      title: "Timetable",
      description: "Generate a draft, review and adjust it, then publish it.",
      state: !versions ? "unknown" : published ? "done" : drafts.length > 0 ? "attention" : input.yearStatus === "DRAFT" ? "todo" : "locked",
      detail: !versions
        ? "Couldn’t check the timetables."
        : published
          ? `Version ${published.versionNumber} is published.`
          : drafts.length > 0
            ? `${plural(drafts.length, "draft")}, none published yet.`
            : input.yearStatus === "DRAFT"
              ? "No timetable generated yet."
              : "No timetable. Generation is closed for this year.",
      href: published || drafts.length ? "/timetables" : "/generate",
      cta: published ? "View timetables" : drafts.length ? "Review drafts" : "Generate",
    },
  ];
  return steps;
}

/** Steps that count toward completion (optional steps are excluded). */
export function completion(steps: SetupStep[]): { done: number; total: number } {
  const counted = steps.filter((s) => s.state !== "optional");
  return { done: counted.filter((s) => s.state === "done").length, total: counted.length };
}

export function nextStep(steps: SetupStep[]): SetupStep | undefined {
  return steps.find((s) => s.state === "todo" || s.state === "attention");
}
