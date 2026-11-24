import { describe, expect, it } from "vitest";
import { completion, computeSetupSteps, nextStep } from "./progress";

const byId = (steps: ReturnType<typeof computeSetupSteps>) => Object.fromEntries(steps.map((s) => [s.id, s]));

describe("computeSetupSteps", () => {
  it("marks every step unknown when nothing loaded (never claims progress without data)", () => {
    const steps = byId(computeSetupSteps({ yearStatus: "DRAFT" }));
    expect(steps.schedule!.state).toBe("unknown");
    expect(steps.classes!.state).toBe("unknown");
    expect(steps.readiness!.state).toBe("unknown");
    expect(steps.assignments!.state).toBe("optional");
  });

  it("a fresh empty year is all to-do and points at the schedule first", () => {
    const steps = computeSetupSteps({
      yearStatus: "DRAFT",
      schedule: [],
      curriculum: { academicYear: { id: "y", name: "Y", status: "DRAFT" }, weeklySlots: null, grades: [], subjects: [], issues: [] },
      subjects: [],
      teachers: [],
      assignments: [],
      versions: [],
    });
    const map = byId(steps);
    expect(map.schedule!.state).toBe("todo");
    expect(map.classes!.state).toBe("todo");
    expect(map.timetable!.state).toBe("todo");
    expect(nextStep(steps)?.id).toBe("schedule");
    expect(completion(steps).done).toBe(0);
    expect(completion(steps).total).toBe(8);
  });

  it("an ACTIVE year without versions reports generation as closed (locked)", () => {
    const map = byId(computeSetupSteps({ yearStatus: "ACTIVE", versions: [] }));
    expect(map.timetable!.state).toBe("locked");
  });

  it("eligibility needs attention when readiness reports NO_ELIGIBLE_TEACHER", () => {
    const feasibility = {
      status: "NOT_READY",
      summary: { errorCount: 1, warningCount: 0 },
      errors: [{ code: "NO_ELIGIBLE_TEACHER" }],
      warnings: [],
    } as unknown as Parameters<typeof computeSetupSteps>[0]["feasibility"];
    const map = byId(computeSetupSteps({ yearStatus: "DRAFT", feasibility }));
    expect(map.eligibility!.state).toBe("attention");
    expect(map.readiness!.state).toBe("attention");
  });
});
