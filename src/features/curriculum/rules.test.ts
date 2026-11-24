import { describe, expect, it } from "vitest";
import type { CurriculumOverview } from "@/lib/api/schemas";
import {
  buildReplaceBody,
  copySources,
  demandStatus,
  describeChanges,
  linesFromGroup,
  linesTotal,
  parsePeriods,
  sectionDemandFromLines,
  summarisePlan,
  updateDetail,
  validateLines,
  type EditorLine,
} from "./rules";

const line = (partial: Partial<EditorLine>): EditorLine => ({
  key: Math.random().toString(),
  subjectId: "s1",
  periodsPerWeek: "4",
  isOptional: false,
  sectionScope: "ALL_SECTIONS",
  sectionIds: [],
  ...partial,
});

describe("periods per week", () => {
  it("is a strict whole number", () => {
    expect(parsePeriods("5")).toBe(5);
    expect(parsePeriods(" 12 ")).toBe(12);
    expect(parsePeriods("5.5")).toBeNaN();
    expect(parsePeriods("")).toBeNaN();
    expect(parsePeriods("-1")).toBeNaN();
  });
});

describe("replace body", () => {
  it("sends the complete list with real JSON numbers, and sectionIds only for selected sections", () => {
    const body = buildReplaceBody("stream-1", [line({}), line({ subjectId: "s2", periodsPerWeek: "2", isOptional: true, sectionScope: "SELECTED_SECTIONS", sectionIds: ["a"] })], true);
    expect(body).toEqual({
      streamId: "stream-1",
      dryRun: true,
      requirements: [
        { subjectId: "s1", periodsPerWeek: 4, isOptional: false, sectionScope: "ALL_SECTIONS" },
        { subjectId: "s2", periodsPerWeek: 2, isOptional: true, sectionScope: "SELECTED_SECTIONS", sectionIds: ["a"] },
      ],
    });
  });
  it("omits streamId for an unstreamed grade, and an empty list clears the curriculum", () => {
    expect(buildReplaceBody(null, [], false)).toEqual({ dryRun: false, requirements: [] });
  });
});

describe("line validation (keyed like requirements.N.field)", () => {
  it("flags missing subject, duplicates, out-of-range periods and empty selections", () => {
    const errors = validateLines(
      [
        line({ subjectId: "" }),
        line({ periodsPerWeek: "41" }),
        line({ periodsPerWeek: "0" }),
        line({ subjectId: "s2", periodsPerWeek: "" }),
        line({ subjectId: "s3", sectionScope: "SELECTED_SECTIONS", sectionIds: ["gone"] }),
      ],
      ["a", "b"],
    );
    expect(errors["requirements.0.subjectId"]).toMatch(/Choose a subject/);
    expect(errors["requirements.1.periodsPerWeek"]).toMatch(/1 to 40/);
    expect(errors["requirements.2.subjectId"]).toMatch(/already listed \(row 2\)/);
    expect(errors["requirements.2.periodsPerWeek"]).toMatch(/1 to 40/);
    expect(errors["requirements.3.periodsPerWeek"]).toMatch(/Enter/);
    expect(errors["requirements.4.sectionIds"]).toMatch(/at least one section/);
  });
  it("accepts valid lines", () => {
    expect(validateLines([line({}), line({ subjectId: "s2", periodsPerWeek: "40", sectionScope: "SELECTED_SECTIONS", sectionIds: ["a"] })], ["a"])).toEqual({});
  });
});

describe("totals and per-section demand", () => {
  const lines = [line({ periodsPerWeek: "5" }), line({ subjectId: "s2", periodsPerWeek: "3", sectionScope: "SELECTED_SECTIONS", sectionIds: ["b"] }), line({ subjectId: "s3", periodsPerWeek: "x" })];
  it("adds up valid numbers only", () => {
    expect(linesTotal(lines)).toBe(8);
  });
  it("counts selected-section lines only for their sections", () => {
    expect(Object.fromEntries(sectionDemandFromLines(lines, ["a", "b"]))).toEqual({ a: 5, b: 8 });
  });
  it("compares demand with the schedule's weekly slots", () => {
    expect(demandStatus(41, 40)).toBe("over");
    expect(demandStatus(40, 40)).toBe("exact");
    expect(demandStatus(30, 40)).toBe("under");
    expect(demandStatus(30, null)).toBe("unknown");
  });
});

describe("dry-run plan summary", () => {
  it("describes what would change", () => {
    const plan = {
      create: [{ subjectId: "a", subjectName: "Art", periodsPerWeek: 2 }],
      update: [{ id: "r", subjectId: "m", subjectName: "Maths", changes: ["periodsPerWeek", "sections"], from: { periodsPerWeek: 5 }, to: { periodsPerWeek: 6, isOptional: false } }],
      remove: [{ id: "r2", subjectId: "h", subjectName: "History", periodsPerWeek: 3 }],
      unchanged: 4,
    };
    const summary = summarisePlan(plan);
    expect(summary).toMatchObject({ create: 1, update: 1, remove: 1, unchanged: 4, hasChanges: true });
    expect(summary.sentence).toBe("This will add 1, change 1 and remove 1 subjects; 4 stay as they are.");
    expect(describeChanges(plan.update[0].changes)).toBe("periods per week, sections");
    expect(updateDetail(plan.update[0])).toEqual({ fromPeriods: 5, toPeriods: 6, toOptional: false });
  });
  it("says when nothing would change", () => {
    const summary = summarisePlan({ create: [], update: [], remove: [], unchanged: 3 });
    expect(summary.hasChanges).toBe(false);
    expect(summary.sentence).toMatch(/already matches/);
  });
});

describe("copy sources and editor lines", () => {
  const overview = {
    academicYear: { id: "y", name: "Y", status: "DRAFT" },
    weeklySlots: null,
    grades: [
      {
        id: "g2",
        name: "Grade 2",
        displayOrder: 2,
        streamed: false,
        streams: [],
        sectionCount: 1,
        curricula: [
          {
            streamId: null,
            stream: null,
            label: "Grade 2",
            sectionCount: 1,
            sections: [{ id: "sa", name: "A", code: "A", periodsPerWeek: 4 }],
            requirements: [
              { id: "r1", subject: { id: "s1", name: "Maths", code: "MATH" }, periodsPerWeek: 4, isOptional: false, sectionScope: "SELECTED_SECTIONS", sectionIds: ["sa"], appliesToSections: 1, classification: "SECTION_SPECIFIC" },
            ],
            totalPeriods: 4,
          },
        ],
      },
      { id: "g1", name: "Grade 1", displayOrder: 1, streamed: false, streams: [], sectionCount: 0, curricula: [{ streamId: null, stream: null, label: "Grade 1", sectionCount: 0, sections: [], requirements: [], totalPeriods: 0 }] },
    ],
    subjects: [],
    issues: [],
  } satisfies CurriculumOverview;

  it("offers other groups that have subjects", () => {
    expect(copySources(overview, { gradeId: "g1", streamId: null }).map((o) => o.label)).toEqual(["Grade 2"]);
    expect(copySources(overview, { gradeId: "g2", streamId: null })).toEqual([]);
  });

  it("loads existing requirements into the editor", () => {
    const lines = linesFromGroup(overview.grades[0].curricula[0]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ subjectId: "s1", periodsPerWeek: "4", sectionScope: "SELECTED_SECTIONS", sectionIds: ["sa"] });
  });
});
