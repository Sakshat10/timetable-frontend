import { describe, expect, it } from "vitest";
import {
  activeRunId,
  failureGuidance,
  formatDuration,
  generateGate,
  issueLink,
  PHASES,
  phaseIndex,
  pickAdoptableRun,
  readRunResult,
  stepStates,
} from "./rules";

const base = "/years/y1";

describe("phase ordering", () => {
  it("lists the documented phases in execution order", () => {
    expect(PHASES.map((p) => p.phase)).toEqual([
      null,
      "CLAIMED",
      "SNAPSHOT",
      "FEASIBILITY",
      "NORMALIZE",
      "BASELINE",
      "SOLVING",
      "VALIDATING",
      "METRICS",
      "PERSISTING",
      "DONE",
    ]);
    expect(PHASES.at(-2)?.label).toBe("Saving");
  });

  it("indexes phases and returns -1 for unknown values", () => {
    expect(phaseIndex(null)).toBe(0);
    expect(phaseIndex("SOLVING")).toBe(6);
    expect(phaseIndex("SOMETHING_NEW")).toBe(-1);
  });

  it("marks earlier steps complete and the current one active while running", () => {
    const states = stepStates({ status: "RUNNING", phase: "SOLVING" });
    expect(states.slice(0, 6).every((s) => s === "complete")).toBe(true);
    expect(states[6]).toBe("current");
    expect(states.slice(7).every((s) => s === "pending")).toBe(true);
  });

  it("shows a queued run on the first step", () => {
    const states = stepStates({ status: "QUEUED", phase: null });
    expect(states[0]).toBe("current");
    expect(states.slice(1).every((s) => s === "pending")).toBe(true);
  });

  it("marks the step a failed run stopped at as failed", () => {
    const states = stepStates({ status: "FAILED", phase: "VALIDATING" });
    expect(states[7]).toBe("failed");
    expect(states[6]).toBe("complete");
    expect(states[8]).toBe("pending");
  });

  it("completes every step on success", () => {
    expect(stepStates({ status: "SUCCEEDED", phase: "DONE" }).every((s) => s === "complete")).toBe(true);
  });

  it("formats durations without implying an ETA", () => {
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(65)).toBe("1 min 05 s");
  });
});

describe("failure-code guidance (§4.3)", () => {
  it.each([
    ["NOT_READY", "recheck"],
    ["YEAR_NOT_DRAFT", "recheck"],
    ["CONFIGURATION_CHANGED", "regenerate"],
    ["INFEASIBLE_HARD_CONSTRAINTS", "review-setup"],
    ["NO_SOLUTION_WITH_LOCKS", "adjust-locks"],
    ["LOCKS_INVALID", "adjust-locks"],
    ["DRAFT_LIMIT_REACHED", "manage-drafts"],
    ["QUEUE_EXPIRED", "retry"],
  ])("%s → %s", (code, action) => {
    const g = failureGuidance(code);
    expect(g.action).toBe(action);
    expect(g.showCode).toBe(false);
  });

  it.each(["WORKER_LOST", "PERSIST_FAILED", "SOLVER_UNAVAILABLE", "SOLVER_CRASHED", "SOLVER_INVALID_OUTPUT", "SOLVER_MODEL_INVALID", "SOLVER_INPUT_REJECTED", "INTERNAL_INCONSISTENCY", "UNKNOWN_CODE"])(
    "server fault %s → generic retry with the code shown",
    (code) => {
      const g = failureGuidance(code);
      expect(g.action).toBe("retry");
      expect(g.showCode).toBe(true);
    },
  );
});

describe("run recovery (§4.4)", () => {
  const run = (id: string, status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED", createdAt: string) => ({ id, status, createdAt });

  it("adopts the newest active run first", () => {
    const runs = [run("new", "SUCCEEDED", "2031-05-01T10:05:00Z"), run("active", "RUNNING", "2031-05-01T10:04:00Z")];
    expect(pickAdoptableRun(runs, new Set(["active"]))).toBe("active");
  });

  it("otherwise adopts the newest run that did not exist before the click", () => {
    const runs = [run("new", "SUCCEEDED", "2031-05-01T10:05:00Z"), run("old", "FAILED", "2031-05-01T09:00:00Z")];
    expect(pickAdoptableRun(runs, new Set(["old"]))).toBe("new");
  });

  it("adopts nothing when no new or active run exists", () => {
    const runs = [run("old", "FAILED", "2031-05-01T09:00:00Z")];
    expect(pickAdoptableRun(runs, new Set(["old"]))).toBeNull();
  });

  it("resumes an active run on page load", () => {
    expect(activeRunId([run("a", "SUCCEEDED", "2031-05-01T10:00:00Z"), run("b", "QUEUED", "2031-05-01T09:00:00Z")])).toBe("b");
    expect(activeRunId([run("a", "SUCCEEDED", "2031-05-01T10:00:00Z")])).toBeNull();
    expect(activeRunId(undefined)).toBeNull();
  });
});

describe("generate gate", () => {
  const draft = { status: "DRAFT" as const, name: "2031-32" };
  it("allows a DRAFT year with a READY report", () => {
    expect(generateGate({ year: draft, report: { status: "READY" }, reportFailed: false, runActive: false })).toEqual({ allowed: true });
  });
  it("closes generation for ACTIVE and COMPLETED years", () => {
    for (const status of ["ACTIVE", "COMPLETED"] as const) {
      const gate = generateGate({ year: { status, name: "x" }, report: { status: "READY" }, reportFailed: false, runActive: false });
      expect(gate).toMatchObject({ allowed: false, reason: "closed" });
    }
  });
  it("blocks while NOT_READY, while checking and while a run is active", () => {
    expect(generateGate({ year: draft, report: { status: "NOT_READY" }, reportFailed: false, runActive: false })).toMatchObject({ reason: "not-ready" });
    expect(generateGate({ year: draft, report: undefined, reportFailed: false, runActive: false })).toMatchObject({ reason: "checking" });
    expect(generateGate({ year: draft, report: undefined, reportFailed: true, runActive: false })).toMatchObject({ reason: "check-failed" });
    expect(generateGate({ year: draft, report: { status: "READY" }, reportFailed: false, runActive: true })).toMatchObject({ reason: "run-active" });
  });
});

describe("readiness deep links", () => {
  const issue = (code: string, type: string, id: string | null = null) => ({ code, entity: { type, id, label: "x" } }) as never;
  it("maps codes and entity types to the page that fixes them", () => {
    expect(issueLink(issue("SCHEDULE_CONFIG_MISSING", "ACADEMIC_YEAR", "y1"), base)?.href).toBe(`${base}/schedule`);
    expect(issueLink(issue("NO_SECTIONS", "ACADEMIC_YEAR", "y1"), base)?.href).toBe(`${base}/classes`);
    expect(issueLink(issue("NO_SUBJECT_REQUIREMENTS", "ACADEMIC_YEAR", "y1"), base)?.href).toBe(`${base}/curriculum`);
    expect(issueLink(issue("SECTION_CAPACITY_EXCEEDED", "SECTION", "s1"), base)?.href).toBe(`${base}/curriculum`);
    expect(issueLink(issue("INVALID_ASSIGNMENT", "ASSIGNMENT", "a1"), base)?.href).toBe(`${base}/assignments`);
    expect(issueLink(issue("TEACHER_CAPACITY_EXCEEDED", "TEACHER", "t1"), base)?.href).toBe(`${base}/teachers/t1`);
    expect(issueLink(issue("NO_ELIGIBLE_TEACHER", "SUBJECT_GROUP", "g1"), base)?.href).toBe(`${base}/teachers`);
    expect(issueLink(issue("ACADEMIC_YEAR_NOT_DRAFT", "ACADEMIC_YEAR", "y1"), base)).toBeNull();
  });
});

describe("run result", () => {
  it("reads documented keys and ignores malformed ones", () => {
    expect(readRunResult({ solutionSource: "CP_SAT", versionNumber: 4, entryCount: 60, warnings: ["CP_SAT_WORSE_THAN_BASELINE", 3] })).toMatchObject({
      solutionSource: "CP_SAT",
      versionNumber: 4,
      entryCount: 60,
      warnings: ["CP_SAT_WORSE_THAN_BASELINE"],
    });
    expect(readRunResult(null)).toMatchObject({ solutionSource: null, versionNumber: null, warnings: [] });
  });
});
