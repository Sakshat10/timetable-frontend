import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { CurriculumOverview } from "@/lib/api/schemas";
import type { GradeEligibility, SectionAssignment, TeacherListItem, TeacherSubjectLink } from "@/lib/api/types";
import { buildCandidates, buildGrid, filterGrid, indexPins, pinCounts, pinErrorMessage } from "./rules";

const YEAR = "y1";
const MATH = "math";
const teacher = (id: string, isActive = true, subjects = [MATH]): TeacherListItem => ({
  id,
  schoolId: "s",
  name: `Teacher ${id}`,
  employeeCode: null,
  isActive,
  createdAt: "",
  updatedAt: "",
  subjects: subjects.map((s) => ({ id: s, name: s, code: s, type: "PRIMARY" as const })),
});
const link = (teacherId: string, gradeScope: "ALL_GRADES" | "SELECTED_GRADES", subjectId = MATH): TeacherSubjectLink => ({
  id: `link-${teacherId}`,
  teacherId,
  subjectId,
  type: "PRIMARY",
  gradeScope,
  subject: { id: subjectId, name: subjectId, code: subjectId },
  createdAt: "",
  updatedAt: "",
});
const eligibility = (linkId: string, gradeId: string, academicYearId = YEAR): GradeEligibility => ({
  id: `${linkId}-${gradeId}`,
  teacherSubjectId: linkId,
  gradeId,
  grade: { id: gradeId, name: gradeId, displayOrder: 1, academicYearId },
  createdAt: "",
});

describe("buildCandidates", () => {
  const base = { subjectId: MATH, gradeId: "g8", gradeName: "Grade 8", yearId: YEAR };

  it("includes only teachers linked to the subject and ranks eligible first", () => {
    const teachers = [teacher("a"), teacher("b", true, ["art"]), teacher("c", false), teacher("d"), teacher("e")];
    const linksByTeacher = new Map([
      ["a", [link("a", "ALL_GRADES")]],
      ["d", [link("d", "SELECTED_GRADES")]],
      ["e", [link("e", "SELECTED_GRADES")]],
    ]);
    const gradesByLink = new Map([
      ["link-d", []], // SELECTED_GRADES with no rows: not eligible
      ["link-e", [eligibility("link-e", "g8")]],
    ]);
    const result = buildCandidates({ ...base, teachers, linksByTeacher, gradesByLink });
    expect(result.map((c) => [c.teacher.id, c.status])).toEqual([
      ["a", "eligible"],
      ["e", "eligible"],
      ["d", "not-eligible"],
      ["c", "inactive"],
    ]);
    expect(result.find((c) => c.teacher.id === "d")?.reason).toBe("Not eligible for Grade 8");
  });

  it("ignores eligibility rows from another year", () => {
    const result = buildCandidates({
      ...base,
      teachers: [teacher("x")],
      linksByTeacher: new Map([["x", [link("x", "SELECTED_GRADES")]]]),
      gradesByLink: new Map([["link-x", [eligibility("link-x", "g8", "other-year")]]]),
    });
    expect(result[0]?.status).toBe("not-eligible");
  });

  it("reports loading until links and rows arrive", () => {
    const pendingLinks = buildCandidates({ ...base, teachers: [teacher("x")], linksByTeacher: new Map(), gradesByLink: new Map() });
    expect(pendingLinks[0]?.status).toBe("loading");
    const pendingRows = buildCandidates({ ...base, teachers: [teacher("x")], linksByTeacher: new Map([["x", [link("x", "SELECTED_GRADES")]]]), gradesByLink: new Map() });
    expect(pendingRows[0]?.status).toBe("loading");
  });
});

const overview = {
  grades: [
    {
      id: "g11",
      name: "Class 11",
      displayOrder: 11,
      streamed: false,
      streams: [],
      sectionCount: 2,
      curricula: [
        {
          streamId: null,
          stream: null,
          label: "Class 11",
          sectionCount: 2,
          sections: [
            { id: "sA", name: "A", code: "A", periodsPerWeek: 0 },
            { id: "sB", name: "B", code: "B", periodsPerWeek: 0 },
          ],
          requirements: [
            { id: "rM", subject: { id: MATH, name: "Maths", code: "M" }, periodsPerWeek: 5, isOptional: false, sectionScope: "ALL_SECTIONS", sectionIds: [], appliesToSections: 2, classification: "COMMON" },
            { id: "rA", subject: { id: "art", name: "Art", code: "A" }, periodsPerWeek: 2, isOptional: false, sectionScope: "SELECTED_SECTIONS", sectionIds: ["sB"], appliesToSections: 1, classification: "SECTION_SPECIFIC" },
          ],
          totalPeriods: 7,
        },
      ],
    },
  ],
} as unknown as CurriculumOverview;

const pin = { id: "p1", sectionId: "sA", subjectRequirementId: "rM", teacherId: "t1", teacher: { id: "t1", name: "T", employeeCode: null, isActive: true } } as SectionAssignment;

describe("grid", () => {
  it("honours section scope", () => {
    const [group] = buildGrid(overview);
    const art = group?.requirements.find((r) => r.id === "rA");
    expect([...(art?.sectionIds ?? [])]).toEqual(["sB"]);
    expect(group?.requirements.map((r) => r.subjectName)).toEqual(["Art", "Maths"]);
  });

  it("counts applicable cells and pins", () => {
    expect(pinCounts(buildGrid(overview), indexPins([pin]))).toEqual({ cells: 3, pinned: 1 });
  });

  it("filters pinned only and by teacher", () => {
    const grid = buildGrid(overview);
    const pins = indexPins([pin]);
    expect(filterGrid(grid, pins, { gradeId: null, subjectId: null, teacherId: null, pinnedOnly: true })[0]?.requirements.map((r) => r.id)).toEqual(["rM"]);
    expect(filterGrid(grid, pins, { gradeId: null, subjectId: null, teacherId: "other", pinnedOnly: false })).toEqual([]);
    expect(filterGrid(grid, pins, { gradeId: "nope", subjectId: null, teacherId: null, pinnedOnly: false })).toEqual([]);
  });
});

describe("pinErrorMessage", () => {
  const err = (status: number, message: string) => new ApiError({ status, code: null, message, fieldErrors: {}, details: {}, retryAfterMs: null, uncertain: false });
  it("explains the server refusals", () => {
    expect(pinErrorMessage(err(400, "The teacher is inactive and cannot be assigned to a section"))).toMatch(/inactive/);
    expect(pinErrorMessage(err(400, "The teacher is not assigned to teach this subject"))).toMatch(/qualified/);
    expect(pinErrorMessage(err(400, "The teacher is not eligible to teach this subject for the section's grade"))).toMatch(/eligible for this grade/);
    expect(pinErrorMessage(err(409, "duplicate"))).toMatch(/already has a pinned teacher/);
  });
});
