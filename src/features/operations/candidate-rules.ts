/**
 * Substitute picker rules (PHASE-0-AUDIT §6.3). The backend ranks and explains every candidate; these
 * helpers only group what it returned and decide which confirmation step an assignment needs.
 */
import { isApiError } from "@/lib/api/errors";
import type { Candidate, Candidates, Cover } from "@/lib/api/schemas";
import type { ConsecutivePeriodPolicy } from "@/lib/api/types";

export interface CandidateGroups {
  /** Tier 1: teachers with a basis in this subject. */
  sameSubject: Candidate[];
  /** Tier 2: free teachers without a subject basis (temporary, unqualified cover). */
  otherAvailable: Candidate[];
  /** Tier 3 that the backend offers (it would give the teacher four or more consecutive periods). */
  lastResort: Candidate[];
  /** Candidates returned with `offered:false` (tier 3 while a better option exists under PREFER_AVOID). */
  notOffered: Candidate[];
}

/** Groups candidates by tier, keeping the backend's order inside each group. */
export function groupCandidates(candidates: readonly Candidate[]): CandidateGroups {
  const groups: CandidateGroups = { sameSubject: [], otherAvailable: [], lastResort: [], notOffered: [] };
  for (const candidate of candidates) {
    if (!candidate.offered) groups.notOffered.push(candidate);
    else if (candidate.tierKey === "SAME_SUBJECT") groups.sameSubject.push(candidate);
    else if (candidate.tierKey === "OTHER_AVAILABLE") groups.otherAvailable.push(candidate);
    else groups.lastResort.push(candidate);
  }
  return groups;
}

export const TIER_TITLE: Record<Candidate["tierKey"], string> = {
  SAME_SUBJECT: "Same subject",
  OTHER_AVAILABLE: "Other available teachers",
  LAST_RESORT: "Last resort (4+ consecutive periods)",
};

export const POLICY_LABEL: Record<ConsecutivePeriodPolicy, string> = {
  ALLOW: "Four or more consecutive periods are allowed",
  PREFER_AVOID: "Four or more consecutive periods are avoided while another teacher is free",
  NEVER_ALLOW: "Four or more consecutive periods are never assigned",
};

export const EXCLUSION_LABEL: Record<string, string> = {
  IS_ABSENT_TEACHER: "Absent teacher for this lesson",
  INACTIVE: "Inactive",
  ABSENT: "Absent in this period",
  UNAVAILABLE: "Marked unavailable",
  TEACHING_ANOTHER_LESSON: "Teaching another lesson",
  ALREADY_COVERING: "Already covering another lesson",
  CONSECUTIVE_NOT_ALLOWED: "Would teach 4+ consecutive periods (not allowed)",
};

/** Groups the excluded teachers by reason, in the backend's exclusion order. */
export function groupExcluded(excluded: Candidates["excluded"]): Array<{ reason: string; label: string; names: string[] }> {
  const order = Object.keys(EXCLUSION_LABEL);
  const map = new Map<string, string[]>();
  for (const entry of excluded ?? []) {
    const names = map.get(entry.reason) ?? [];
    names.push(entry.teacher.name);
    map.set(entry.reason, names);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)))
    .map(([reason, names]) => ({ reason, label: EXCLUSION_LABEL[reason] ?? reason, names }));
}

/** Whether assigning this candidate needs the explicit last-resort confirmation step first. */
export function needsLastResortConfirmation(candidate: Candidate): boolean {
  return candidate.tierKey === "LAST_RESORT" || candidate.requiresConfirmation || candidate.consecutive.createsFourConsecutive;
}

export type CandidateRole = "current" | "confirm-automatic" | "assign" | "replace";

/** How a candidate relates to the cover: the current substitute, or someone who can be assigned / swapped in. */
export function candidateRole(candidate: Candidate, cover: Pick<Cover, "status" | "replacementTeacher" | "assignmentSource">): CandidateRole {
  if (cover.status === "ASSIGNED" && cover.replacementTeacher?.id === candidate.id) {
    return cover.assignmentSource === "AUTOMATIC" ? "confirm-automatic" : "current";
  }
  return cover.status === "ASSIGNED" ? "replace" : "assign";
}

/** The visible (and accessible) label of a candidate's action button. */
export function candidateActionLabel(candidate: Candidate, role: CandidateRole): string | null {
  if (role === "current") return null;
  if (role === "confirm-automatic") return `Keep ${candidate.name}`;
  if (needsLastResortConfirmation(candidate)) return `Review and assign ${candidate.name} as a last resort`;
  return role === "replace" ? `Use ${candidate.name} instead` : `Assign ${candidate.name}`;
}

/** "P2–P5 (4 periods in a row)" for a candidate's resulting run, or null when the cover stands alone. */
export function consecutiveText(consecutive: Candidate["consecutive"]): string {
  if (consecutive.resultingRun <= 1) return "No adjacent teaching periods";
  return `P${consecutive.from}–P${consecutive.to} (${consecutive.resultingRun} periods in a row)`;
}

const REFRESH_CANDIDATES = new Set(["ABSENT", "UNAVAILABLE", "TEACHING_ANOTHER_LESSON", "ALREADY_COVERING", "REPLACEMENT_ALREADY_BOOKED", "CONSECUTIVE_NOT_ALLOWED"]);
const REFRESH_BOARD = new Set(["COVER_OBSOLETE", "COVER_CANCELLED"]);

export type AssignOutcome =
  | { kind: "confirm"; periods: number[]; message: string }
  | { kind: "not-allowed"; message: string }
  | { kind: "refresh-candidates"; message: string }
  | { kind: "refresh-board"; message: string }
  | { kind: "ineligible"; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "error"; message: string };

/** Parses `errors.periods` (strings such as "2") into sorted period numbers. */
export function periodsFromDetails(details: Record<string, unknown>): number[] {
  const raw = details.periods;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

/** Decides what the picker does after a failed PUT /substitutions/:id/assignment. */
export function assignOutcome(error: unknown): AssignOutcome {
  if (!isApiError(error)) return { kind: "error", message: "Something went wrong. Please try again." };
  if (error.uncertain) return { kind: "uncertain", message: error.message };
  const code = error.code ?? "";
  if (code === "FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED") return { kind: "confirm", periods: periodsFromDetails(error.details), message: error.message };
  if (code === "FOUR_CONSECUTIVE_NOT_ALLOWED") return { kind: "not-allowed", message: error.message };
  if (REFRESH_CANDIDATES.has(code)) return { kind: "refresh-candidates", message: error.message };
  if (REFRESH_BOARD.has(code)) return { kind: "refresh-board", message: error.message };
  if (code === "IS_ABSENT_TEACHER" || code === "INACTIVE") return { kind: "ineligible", message: error.message };
  return { kind: "error", message: error.message };
}

/** "P3, P4, P5 and P6" */
export function periodsText(periods: readonly number[]): string {
  const labels = periods.map((p) => `P${p}`);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
