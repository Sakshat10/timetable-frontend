import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { Candidate, Cover } from "@/lib/api/schemas";
import {
  assignOutcome,
  candidateActionLabel,
  candidateRole,
  consecutiveText,
  groupCandidates,
  groupExcluded,
  needsLastResortConfirmation,
  periodsFromDetails,
  periodsText,
} from "./candidate-rules";

function candidate(overrides: Partial<Candidate> & Pick<Candidate, "id" | "tierKey">): Candidate {
  const tier = overrides.tierKey === "SAME_SUBJECT" ? 1 : overrides.tierKey === "OTHER_AVAILABLE" ? 2 : 3;
  return {
    name: `Teacher ${overrides.id}`,
    employeeCode: null,
    tier,
    offered: true,
    recommended: false,
    requiresConfirmation: tier === 3,
    subjectBasis: tier === 1 ? "PRIMARY_LINK" : null,
    sameSubject: tier === 1,
    gradeEligible: true,
    weeklyLoad: 10,
    recentCovers: 0,
    temporaryUnqualified: tier === 2,
    free: true,
    coverLoadToday: 0,
    consecutive: { resultingRun: tier === 3 ? 4 : 1, from: 3, to: tier === 3 ? 6 : 3, periods: tier === 3 ? [3, 4, 5, 6] : [3], createsFourConsecutive: tier === 3, threshold: 4 },
    explanation: "",
    ...overrides,
  } as Candidate;
}

const apiError = (status: number, code: string | null, details: Record<string, unknown> = {}, uncertain = false) =>
  new ApiError({ status, code, message: `refused ${code}`, fieldErrors: {}, details, retryAfterMs: null, uncertain });

describe("groupCandidates", () => {
  it("groups by tier, keeps the backend order, and puts offered:false in its own group", () => {
    const list = [
      candidate({ id: "a", tierKey: "SAME_SUBJECT", recommended: true }),
      candidate({ id: "b", tierKey: "OTHER_AVAILABLE" }),
      candidate({ id: "c", tierKey: "SAME_SUBJECT" }),
      candidate({ id: "d", tierKey: "LAST_RESORT", offered: false }),
      candidate({ id: "e", tierKey: "LAST_RESORT" }),
      candidate({ id: "f", tierKey: "OTHER_AVAILABLE" }),
    ];
    const groups = groupCandidates(list);
    expect(groups.sameSubject.map((c) => c.id)).toEqual(["a", "c"]);
    expect(groups.otherAvailable.map((c) => c.id)).toEqual(["b", "f"]);
    expect(groups.lastResort.map((c) => c.id)).toEqual(["e"]);
    expect(groups.notOffered.map((c) => c.id)).toEqual(["d"]);
  });

  it("returns empty groups for no candidates", () => {
    expect(groupCandidates([])).toEqual({ sameSubject: [], otherAvailable: [], lastResort: [], notOffered: [] });
  });
});

describe("groupExcluded", () => {
  it("groups names by reason in the backend's exclusion order", () => {
    const groups = groupExcluded([
      { teacher: { id: "1", name: "A", employeeCode: null }, reason: "TEACHING_ANOTHER_LESSON" },
      { teacher: { id: "2", name: "B", employeeCode: null }, reason: "IS_ABSENT_TEACHER" },
      { teacher: { id: "3", name: "C", employeeCode: null }, reason: "TEACHING_ANOTHER_LESSON" },
    ]);
    expect(groups.map((g) => [g.reason, g.names])).toEqual([
      ["IS_ABSENT_TEACHER", ["B"]],
      ["TEACHING_ANOTHER_LESSON", ["A", "C"]],
    ]);
    expect(groupExcluded(undefined)).toEqual([]);
  });
});

describe("last-resort confirmation decision", () => {
  it("requires confirmation for tier 3, requiresConfirmation, or a run of four", () => {
    expect(needsLastResortConfirmation(candidate({ id: "a", tierKey: "SAME_SUBJECT" }))).toBe(false);
    expect(needsLastResortConfirmation(candidate({ id: "b", tierKey: "OTHER_AVAILABLE" }))).toBe(false);
    expect(needsLastResortConfirmation(candidate({ id: "c", tierKey: "LAST_RESORT" }))).toBe(true);
    expect(needsLastResortConfirmation(candidate({ id: "d", tierKey: "SAME_SUBJECT", requiresConfirmation: true }))).toBe(true);
  });

  it("asks the server-requested confirmation with the periods from errors.periods", () => {
    const outcome = assignOutcome(apiError(409, "FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED", { periods: ["5", "3", "4", "6"] }));
    expect(outcome).toMatchObject({ kind: "confirm", periods: [3, 4, 5, 6] });
  });

  it("maps every assignment refusal to the right follow-up", () => {
    expect(assignOutcome(apiError(409, "FOUR_CONSECUTIVE_NOT_ALLOWED")).kind).toBe("not-allowed");
    for (const code of ["ABSENT", "UNAVAILABLE", "TEACHING_ANOTHER_LESSON", "ALREADY_COVERING", "REPLACEMENT_ALREADY_BOOKED"]) {
      expect(assignOutcome(apiError(409, code)).kind).toBe("refresh-candidates");
    }
    expect(assignOutcome(apiError(409, "COVER_OBSOLETE")).kind).toBe("refresh-board");
    expect(assignOutcome(apiError(409, "COVER_CANCELLED")).kind).toBe("refresh-board");
    expect(assignOutcome(apiError(400, "IS_ABSENT_TEACHER")).kind).toBe("ineligible");
    expect(assignOutcome(apiError(400, "INACTIVE")).kind).toBe("ineligible");
    expect(assignOutcome(apiError(500, null, {}, true)).kind).toBe("uncertain");
    expect(assignOutcome(new Error("x")).kind).toBe("error");
  });

  it("parses periods defensively", () => {
    expect(periodsFromDetails({})).toEqual([]);
    expect(periodsFromDetails({ periods: ["2", "x", "0", "3"] })).toEqual([2, 3]);
    expect(periodsText([3, 4, 5, 6])).toBe("P3, P4, P5 and P6");
    expect(periodsText([2])).toBe("P2");
  });
});

describe("candidate roles and labels", () => {
  const open = { status: "OPEN", replacementTeacher: null, assignmentSource: null } as Pick<Cover, "status" | "replacementTeacher" | "assignmentSource">;
  const assignedAuto = { status: "ASSIGNED", replacementTeacher: { id: "a", name: "A" }, assignmentSource: "AUTOMATIC" } as Pick<Cover, "status" | "replacementTeacher" | "assignmentSource">;
  const assignedManual = { ...assignedAuto, assignmentSource: "MANUAL" } as Pick<Cover, "status" | "replacementTeacher" | "assignmentSource">;

  it("labels assign, replace, keep and last-resort actions", () => {
    const a = candidate({ id: "a", tierKey: "SAME_SUBJECT", name: "Asha" });
    const b = candidate({ id: "b", tierKey: "OTHER_AVAILABLE", name: "Bala" });
    const c = candidate({ id: "c", tierKey: "LAST_RESORT", name: "Chen" });
    expect(candidateActionLabel(a, candidateRole(a, open))).toBe("Assign Asha");
    expect(candidateActionLabel(b, candidateRole(b, assignedAuto))).toBe("Use Bala instead");
    expect(candidateActionLabel(a, candidateRole(a, assignedAuto))).toBe("Keep Asha");
    expect(candidateActionLabel(a, candidateRole(a, assignedManual))).toBeNull();
    expect(candidateActionLabel(c, candidateRole(c, open))).toBe("Review and assign Chen as a last resort");
  });

  it("describes the consecutive run", () => {
    expect(consecutiveText({ resultingRun: 1, from: 3, to: 3, periods: [3], createsFourConsecutive: false, threshold: 4 })).toBe("No adjacent teaching periods");
    expect(consecutiveText({ resultingRun: 4, from: 2, to: 5, periods: [2, 3, 4, 5], createsFourConsecutive: true, threshold: 4 })).toBe("P2–P5 (4 periods in a row)");
  });
});
