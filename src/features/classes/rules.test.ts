import { describe, expect, it } from "vitest";
import type { CurriculumGrade } from "@/lib/api/schemas";
import {
  buildStructurePayload,
  canAddStream,
  filterGrades,
  gradeMode,
  nextDisplayOrder,
  sectionNeedsStream,
  sortGrades,
  structurePaths,
  validateStructure,
  type StructureGradeRow,
} from "./rules";

function group(streamId: string | null, sections: Array<{ name: string; code: string }>) {
  return {
    streamId,
    stream: streamId ? { id: streamId, name: `Stream ${streamId}`, code: streamId.toUpperCase() } : null,
    label: "x",
    sectionCount: sections.length,
    sections: sections.map((s, i) => ({ id: `${streamId ?? "n"}-${i}`, ...s, periodsPerWeek: 0 })),
    requirements: [],
    totalPeriods: 0,
  };
}

function grade(partial: Partial<CurriculumGrade> & Pick<CurriculumGrade, "curricula">): CurriculumGrade {
  return { id: "g1", name: "Grade 1", displayOrder: 1, streamed: false, streams: [], sectionCount: 0, ...partial };
}

describe("grade mode (a grade is all-streamed or all-unstreamed)", () => {
  it("empty grade: streams may be added, sections need no stream", () => {
    const g = grade({ curricula: [group(null, [])] });
    expect(gradeMode(g)).toBe("empty");
    expect(canAddStream(g)).toBe(true);
    expect(sectionNeedsStream(g)).toBe(false);
  });
  it("unstreamed grade: no streams can be added", () => {
    const g = grade({ curricula: [group(null, [{ name: "A", code: "A" }])] });
    expect(gradeMode(g)).toBe("unstreamed");
    expect(canAddStream(g)).toBe(false);
    expect(sectionNeedsStream(g)).toBe(false);
  });
  it("grade with streams but no sections: sections need a stream", () => {
    const g = grade({ streams: [{ id: "s", name: "Science", code: "SCI" }], curricula: [group("s", [])] });
    expect(gradeMode(g)).toBe("streamed");
    expect(canAddStream(g)).toBe(true);
    expect(sectionNeedsStream(g)).toBe(true);
  });
  it("mixed legacy data is reported as mixed", () => {
    const g = grade({ streams: [{ id: "s", name: "Science", code: "SCI" }], curricula: [group("s", [{ name: "A", code: "A" }]), group(null, [{ name: "B", code: "B" }])] });
    expect(gradeMode(g)).toBe("mixed");
    expect(sectionNeedsStream(g)).toBe(true);
  });
});

describe("sorting, search and display order", () => {
  const grades = [
    grade({ id: "b", name: "Grade 10", displayOrder: 10, curricula: [group(null, [{ name: "Section Rose", code: "R" }])] }),
    grade({ id: "a", name: "Grade 2", displayOrder: 2, curricula: [group(null, [])] }),
  ];
  it("sorts by display order", () => {
    expect(sortGrades(grades).map((g) => g.id)).toEqual(["a", "b"]);
  });
  it("matches grade, stream or section names", () => {
    expect(filterGrades(grades, "rose").map((g) => g.id)).toEqual(["b"]);
    expect(filterGrades(grades, "grade 2").map((g) => g.id)).toEqual(["a"]);
    expect(filterGrades(grades, "  ")).toHaveLength(2);
  });
  it("suggests the next display order", () => {
    expect(nextDisplayOrder(grades)).toBe(11);
    expect(nextDisplayOrder([])).toBe(1);
  });
});

describe("bulk grade structure payload", () => {
  const rows: StructureGradeRow[] = [
    { key: "1", name: " Grade 11 ", displayOrder: "11", useStreams: true, streams: [{ key: "s", name: "Science", code: "sci" }], sections: [{ key: "x", name: "A", code: "A", streamCode: "SCI" }] },
    { key: "2", name: "Grade 12", displayOrder: "12", useStreams: false, streams: [{ key: "ignored", name: "x", code: "x" }], sections: [{ key: "y", name: "A", code: "A", streamCode: "SCI" }] },
  ];

  it("keeps row positions and only sends streams for streamed grades", () => {
    expect(buildStructurePayload("year", rows)).toEqual({
      academicYearId: "year",
      grades: [
        { name: "Grade 11", displayOrder: 11, streams: [{ name: "Science", code: "sci" }], sections: [{ name: "A", code: "A", streamCode: "SCI" }] },
        { name: "Grade 12", displayOrder: 12, sections: [{ name: "A", code: "A" }] },
      ],
    });
  });

  it("accepts a valid structure", () => {
    expect(validateStructure(buildStructurePayload("year", rows))).toEqual({});
  });

  it("keys errors exactly like the backend (grades.N.sections.M.field)", () => {
    const bad: StructureGradeRow[] = [
      { key: "1", name: "", displayOrder: "0", useStreams: true, streams: [{ key: "s", name: "Science", code: "SCI" }], sections: [{ key: "x", name: "A", code: "", streamCode: "ART" }] },
      { key: "2", name: "Grade 8", displayOrder: "8", useStreams: false, streams: [], sections: [] },
    ];
    const errors = validateStructure(buildStructurePayload("year", bad), [{ name: "Grade 8", displayOrder: 8 }]);
    expect(errors["grades.0.name"]).toMatch(/required/);
    expect(errors["grades.0.displayOrder"]).toMatch(/1 or more/);
    expect(errors["grades.0.sections.0.code"]).toMatch(/required/);
    expect(errors["grades.0.sections.0.streamCode"]).toMatch(/not one of this grade/);
    expect(errors["grades.1.name"]).toMatch(/already exists/);
    expect(errors["grades.1.displayOrder"]).toMatch(/already used/);
  });

  it("flags duplicates inside the request", () => {
    const dup: StructureGradeRow[] = [
      { key: "1", name: "G", displayOrder: "1", useStreams: false, streams: [], sections: [{ key: "a", name: "A", code: "A", streamCode: "" }, { key: "b", name: "A2", code: "A", streamCode: "" }] },
      { key: "2", name: "G", displayOrder: "1", useStreams: false, streams: [], sections: [] },
    ];
    const errors = validateStructure(buildStructurePayload("y", dup));
    expect(errors["grades.0.sections.1.code"]).toMatch(/same code/);
    expect(errors["grades.1.name"]).toMatch(/Same name/);
    expect(errors["grades.1.displayOrder"]).toMatch(/Same display order/);
  });

  it("requires at least one stream when streams are on", () => {
    const rowsNoStream: StructureGradeRow[] = [{ key: "1", name: "G", displayOrder: "1", useStreams: true, streams: [], sections: [] }];
    expect(validateStructure(buildStructurePayload("y", rowsNoStream))["grades.0.streams"]).toBeDefined();
  });

  it("lists every rendered path so server errors can be matched to inputs", () => {
    const paths = structurePaths(rows);
    expect(paths.has("grades.0.sections.0.streamCode")).toBe(true);
    expect(paths.has("grades.0.streams.0.code")).toBe(true);
    expect(paths.has("grades.1.sections.0.code")).toBe(true);
    expect(paths.has("grades.2.name")).toBe(false);
  });
});
