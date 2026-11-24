/**
 * Pure rules for readiness and generation (PHASE-0-AUDIT.md §1.10–1.12, §4; CAPABILITY-BOUNDARIES X1, X2).
 * No React, no network: everything here is unit-tested in rules.test.ts.
 */
import type { AcademicYear, Feasibility, FeasibilityIssue, GenerationRun, RunStatus } from "@/lib/api/types";

// ------------------------------------------------------------------ phases (§4.2)

export interface PhaseStep {
  /** The backend `phase` value; `null` is "queued". */
  phase: string | null;
  label: string;
}

/** Every phase in execution order. There is no percentage (X2): the stepper is the progress display. */
export const PHASES: readonly PhaseStep[] = [
  { phase: null, label: "Queued" },
  { phase: "CLAIMED", label: "Claimed" },
  { phase: "SNAPSHOT", label: "Snapshot" },
  { phase: "FEASIBILITY", label: "Feasibility" },
  { phase: "NORMALIZE", label: "Normalize" },
  { phase: "BASELINE", label: "Baseline" },
  { phase: "SOLVING", label: "Solving" },
  { phase: "VALIDATING", label: "Validating" },
  { phase: "METRICS", label: "Metrics" },
  { phase: "PERSISTING", label: "Saving" },
  { phase: "DONE", label: "Done" },
];

/** Index of a phase in PHASES, or -1 for a value the frontend does not know. */
export function phaseIndex(phase: string | null): number {
  return PHASES.findIndex((step) => step.phase === phase);
}

export type StepState = "complete" | "current" | "failed" | "pending";

/** The state of every stepper step for a run. */
export function stepStates(run: Pick<GenerationRun, "status" | "phase">): StepState[] {
  if (run.status === "SUCCEEDED") return PHASES.map(() => "complete");
  const index = run.status === "QUEUED" ? 0 : phaseIndex(run.phase);
  // A RUNNING run whose phase is still null has been claimed for execution but not reported a phase yet.
  const current = index === -1 ? (run.phase === null ? 0 : -1) : index;
  return PHASES.map((_, i) => {
    if (current === -1) return "pending";
    if (i < current) return "complete";
    if (i === current) return run.status === "FAILED" ? "failed" : "current";
    return "pending";
  });
}

export function isActiveStatus(status: RunStatus): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

/** Seconds between two instants, never negative. */
export function secondsBetween(fromIso: string, toMs: number): number {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
}

/** "1 min 05 s" / "42 s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

// ------------------------------------------------------------------ failure guidance (§4.3)

export type FailureAction = "recheck" | "regenerate" | "adjust-locks" | "review-setup" | "manage-drafts" | "retry";

export interface FailureGuidance {
  title: string;
  description: string;
  action: FailureAction;
  /** Server faults: show the code so it can be quoted to support. */
  showCode: boolean;
}

const SERVER_FAULTS = new Set([
  "WORKER_LOST",
  "PERSIST_FAILED",
  "SOLVER_UNAVAILABLE",
  "SOLVER_CRASHED",
  "SOLVER_INVALID_OUTPUT",
  "SOLVER_MODEL_INVALID",
  "SOLVER_INPUT_REJECTED",
  "INTERNAL_INCONSISTENCY",
]);

export function failureGuidance(code: string | null | undefined): FailureGuidance {
  switch (code) {
    case "NOT_READY":
    case "YEAR_NOT_DRAFT":
      return {
        title: "The setup changed after the run was queued",
        description: "When the run started, the year no longer passed the pre-generation checks. Run the checks again, fix what they report, then generate again.",
        action: "recheck",
        showCode: false,
      };
    case "CONFIGURATION_CHANGED":
      return {
        title: "The setup was edited while the timetable was being generated",
        description: "Nothing was saved, because the result would not match the current setup. Generate again.",
        action: "regenerate",
        showCode: false,
      };
    case "INFEASIBLE_HARD_CONSTRAINTS":
      return {
        title: "No timetable can satisfy the current setup",
        description:
          "The solver proved that the curriculum, teachers and schedule cannot all fit together. Review the readiness report, reduce the demand (periods per week), add eligible teachers or more weekly periods, then generate again.",
        action: "review-setup",
        showCode: false,
      };
    case "NO_SOLUTION_WITH_LOCKS":
    case "LOCKS_INVALID":
      return {
        title: "No timetable could be found that keeps the locked lessons",
        description:
          code === "LOCKS_INVALID"
            ? "Some locked lessons of the source draft no longer fit the current setup. Unlock them in the draft (or generate without a source draft), then generate again."
            : "No timetable was found in time with these locked lessons (this does not prove that none exists). Unlock some lessons in the source draft, then generate again.",
        action: "adjust-locks",
        showCode: false,
      };
    case "DRAFT_LIMIT_REACHED":
      return {
        title: "The year has reached its limit of draft timetables",
        description: "Nothing was created. Delete drafts you no longer need, or publish one, then generate again.",
        action: "manage-drafts",
        showCode: false,
      };
    case "QUEUE_EXPIRED":
      return {
        title: "The run waited too long in the queue",
        description: "The server did not have capacity to start it within 30 minutes. Try generating again later.",
        action: "retry",
        showCode: false,
      };
    default:
      return {
        title: code && SERVER_FAULTS.has(code) ? "The server could not finish generating the timetable" : "The generation failed",
        description: "This was a server-side problem, not a problem with your setup. Try generating again. If it keeps failing, contact support and quote the code below.",
        action: "retry",
        showCode: true,
      };
  }
}

/** Human text for the result warnings the orchestrator emits (unknown codes are shown as-is). */
export function resultWarningText(code: string): string {
  switch (code) {
    case "CP_SAT_WORSE_THAN_BASELINE":
      return "The solver's timetable scored worse than the simple baseline timetable.";
    case "SOLVER_OBJECTIVE_DISAGREES_WITH_AUTHORITATIVE_METRICS":
      return "The solver's own quality score differed from the server's recalculation; the server's score is the one shown.";
    case "REPRODUCIBLE_RUN_STOPPED_BY_WALL_CLOCK":
      return "This reproducible run stopped on its time limit, so running it again may not give the same timetable.";
    default:
      return code;
  }
}

// ------------------------------------------------------------------ run result (§4.2: `result` is an open record)

export interface RunResultSummary {
  solutionSource: "CP_SAT" | "BASELINE" | null;
  solverStatus: string | null;
  fallbackReason: string | null;
  versionNumber: number | null;
  entryCount: number | null;
  runtimeSeconds: number | null;
  warnings: string[];
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Reads the documented keys of `run.result` defensively (the OpenAPI type is an open record). */
export function readRunResult(result: GenerationRun["result"]): RunResultSummary {
  const r = result ?? {};
  const source = str(r.solutionSource);
  return {
    solutionSource: source === "CP_SAT" || source === "BASELINE" ? source : null,
    solverStatus: str(r.solverStatus),
    fallbackReason: str(r.fallbackReason),
    versionNumber: num(r.versionNumber),
    entryCount: num(r.entryCount),
    runtimeSeconds: num(r.runtimeSeconds),
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : [],
  };
}

export const SOLUTION_SOURCE_LABEL: Record<"CP_SAT" | "BASELINE", string> = {
  CP_SAT: "Optimised (CP-SAT solver)",
  BASELINE: "Baseline (solver ran out of time)",
};

// ------------------------------------------------------------------ recovery (§4.4)

/**
 * After an UNCERTAIN start (lost response) or a 409 without an existing run id: choose the run to follow.
 * Never re-POST. Prefer the newest QUEUED/RUNNING run; otherwise the newest run that did not exist before the click.
 * `runs` is newest first (backend order).
 */
export function pickAdoptableRun(runs: readonly Pick<GenerationRun, "id" | "status" | "createdAt">[], knownBefore: ReadonlySet<string>): string | null {
  const sorted = [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = sorted.find((run) => isActiveStatus(run.status));
  if (active) return active.id;
  const fresh = sorted.find((run) => !knownBefore.has(run.id));
  return fresh?.id ?? null;
}

/** The run to resume on a page load without ?run= (§4.4 "page reload"). */
export function activeRunId(runs: readonly Pick<GenerationRun, "id" | "status" | "createdAt">[] | undefined): string | null {
  if (!runs) return null;
  return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((run) => isActiveStatus(run.status))?.id ?? null;
}

// ------------------------------------------------------------------ the generate gate (§4.1)

export type GenerateGate =
  | { allowed: true }
  | { allowed: false; reason: "closed" | "not-ready" | "checking" | "check-failed" | "run-active"; message: string };

export function generateGate(args: {
  year: Pick<AcademicYear, "status" | "name">;
  report: Pick<Feasibility, "status"> | undefined;
  reportFailed: boolean;
  runActive: boolean;
}): GenerateGate {
  const { year, report, reportFailed, runActive } = args;
  if (year.status !== "DRAFT") return { allowed: false, reason: "closed", message: "Generation is closed for this year." };
  if (runActive) return { allowed: false, reason: "run-active", message: "A run is already in progress for this year. Follow it below." };
  if (!report) {
    return reportFailed
      ? { allowed: false, reason: "check-failed", message: "The readiness checks could not be loaded. Run them again first." }
      : { allowed: false, reason: "checking", message: "Running the readiness checks…" };
  }
  if (report.status !== "READY") return { allowed: false, reason: "not-ready", message: "Fix the blocking issues in the readiness report first." };
  return { allowed: true };
}

// ------------------------------------------------------------------ readiness deep links (Appendix A)

export interface IssueLink {
  href: string;
  label: string;
}

/**
 * Where the user fixes an issue. Mapped by code first (the entity of some year-level codes is the year),
 * then by entity type. Returns null when nothing in the app fixes it (ACADEMIC_YEAR_NOT_DRAFT).
 */
export function issueLink(issue: Pick<FeasibilityIssue, "code" | "entity">, basePath: string): IssueLink | null {
  const schedule = { href: `${basePath}/schedule`, label: "Open schedule" };
  const curriculum = { href: `${basePath}/curriculum`, label: "Open curriculum" };
  const classes = { href: `${basePath}/classes`, label: "Open classes" };
  const assignments = { href: `${basePath}/assignments`, label: "Open assignments" };
  const teachers = { href: `${basePath}/teachers`, label: "Open teachers" };

  switch (issue.code) {
    case "ACADEMIC_YEAR_NOT_DRAFT":
      return null;
    case "SCHEDULE_CONFIG_MISSING":
    case "NO_WORKING_DAYS":
    case "NO_PERIODS":
    case "SCHEDULE_CONFIG_INVALID":
      return schedule;
    case "NO_SECTIONS":
      return classes;
    case "NO_SUBJECT_REQUIREMENTS":
    case "SECTION_CAPACITY_EXCEEDED":
    case "SECTION_HAS_NO_REQUIREMENTS":
    case "REQUIREMENT_HAS_NO_SECTIONS":
    case "MIXED_GRADE_MODE":
    case "SECTION_AT_FULL_CAPACITY":
      return curriculum;
    case "INVALID_ASSIGNMENT":
    case "TEACHER_AUTO_ASSIGNED":
      return assignments;
    default:
      break;
  }
  switch (issue.entity.type) {
    case "SCHEDULE_CONFIG":
      return schedule;
    case "SECTION":
    case "REQUIREMENT":
    case "GRADE":
      return curriculum;
    case "ASSIGNMENT":
      return assignments;
    case "TEACHER":
      return issue.entity.id ? { href: `${basePath}/teachers/${issue.entity.id}`, label: "Open teacher" } : teachers;
    case "SUBJECT_GROUP":
    case "SUBJECT_GROUPS":
      return teachers;
    default:
      return null;
  }
}

/** Human label for an issue code (the server message carries the detail). */
export function issueCodeLabel(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}
