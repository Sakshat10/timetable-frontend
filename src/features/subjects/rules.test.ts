import { describe, expect, it } from "vitest";
import type { CurriculumOverview } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";
import { conflictField, splitServerErrors } from "@/features/curriculum/form-errors";
import { buildSubjectsPayload, codeProblem, gradeCounts, normaliseSubjectCode, rowErrorsFromPaths, subjectFormSchema, suggestSubjectCode, subjectUsage, validateSubjectsPayload } from "./rules";

describe("subject codes", () => {
  it("are trimmed and upper-cased like the backend", () => {
    expect(normaliseSubjectCode("  math-1 ")).toBe("MATH-1");
    expect(subjectFormSchema.parse({ name: " Maths ", code: " ma_th " })).toEqual({ name: "Maths", code: "MA_TH" });
  });
  it("reject invalid characters and length", () => {
    expect(codeProblem("-AB")).toMatch(/Start with/);
    expect(codeProblem("A B")).toMatch(/only letters/);
    expect(codeProblem("A".repeat(21))).toMatch(/20/);
    expect(codeProblem("")).toMatch(/Enter/);
    expect(codeProblem("SCI_2")).toBeNull();
  });
});

describe("bulk subjects", () => {
  const rows = [
    { key: "a", name: "Physics", code: "phy" },
    { key: "b", name: " ", code: "" },
    { key: "c", name: "Chemistry", code: "PHY" },
  ];

  it("skips blank rows and remembers which row each request line came from", () => {
    const { subjects, rowKeys } = buildSubjectsPayload(rows);
    expect(subjects).toEqual([
      { name: "Physics", code: "PHY" },
      { name: "Chemistry", code: "PHY" },
    ]);
    expect(rowKeys).toEqual(["a", "c"]);
  });

  it("flags duplicate codes inside the list", () => {
    const { subjects } = buildSubjectsPayload(rows);
    expect(validateSubjectsPayload(subjects)).toEqual({ "subjects.1.code": "Code PHY is repeated in this list" });
    expect(validateSubjectsPayload([])).toEqual({ subjects: "Fill in at least one subject" });
  });

  it("maps row-keyed server errors back to editor rows", () => {
    const error = new ApiError({
      status: 409,
      code: null,
      message: "Some subjects already exist",
      fieldErrors: { "subjects.1.code": ['Subject with code "PHY" already exists in this school'], _form: ["Other"] },
      details: {},
      retryAfterMs: null,
      uncertain: false,
    });
    const { byPath, leftovers } = splitServerErrors(error, (p) => p.startsWith("subjects."));
    expect(leftovers).toEqual(["Other"]);
    const mapped = rowErrorsFromPaths(byPath, ["a", "c"]);
    expect(mapped.rows).toEqual({ c: { code: 'Subject with code "PHY" already exists in this school' } });
    expect(mapped.leftovers).toEqual([]);
  });
});

describe("single-record conflicts", () => {
  it("are attached to the field the message names", () => {
    expect(conflictField('Subject with code "MATH" already exists in this school', ["name", "code"])).toBe("code");
    expect(conflictField("Display order 3 is already used in this academic year", ["name", "displayOrder"])).toBe("displayOrder");
    expect(conflictField('Grade "Grade 8" already exists in this academic year', ["name", "displayOrder"])).toBe("name");
    expect(conflictField("Something else", ["name"])).toBeNull();
  });
});

describe("usage in the selected year", () => {
  const overview = {
    academicYear: { id: "y", name: "2027-28", status: "DRAFT" },
    weeklySlots: 40,
    grades: [
      { id: "g9", name: "Grade 9", displayOrder: 9, streamed: false, streams: [], sectionCount: 1, curricula: [] },
      { id: "g11", name: "Grade 11", displayOrder: 11, streamed: true, streams: [{ id: "s1", name: "Science", code: "SCI" }, { id: "s2", name: "Arts", code: "ART" }], sectionCount: 2, curricula: [] },
    ],
    subjects: [
      {
        subject: { id: "eng", name: "English", code: "ENG" },
        usage: [
          { gradeId: "g11", streamId: "s1", periodsPerWeek: 4, isOptional: false },
          { gradeId: "g9", streamId: null, periodsPerWeek: 5, isOptional: false },
          { gradeId: "g11", streamId: "s2", periodsPerWeek: 6, isOptional: true },
        ],
        gradeCount: 2,
      },
    ],
    issues: [],
  } satisfies CurriculumOverview;

  it("groups usage per grade in display order, with stream names", () => {
    expect(subjectUsage(overview, "eng")).toEqual([
      { gradeId: "g9", gradeName: "Grade 9", displayOrder: 9, lines: [{ streamName: null, periodsPerWeek: 5, isOptional: false }] },
      {
        gradeId: "g11",
        gradeName: "Grade 11",
        displayOrder: 11,
        lines: [
          { streamName: "Arts", periodsPerWeek: 6, isOptional: true },
          { streamName: "Science", periodsPerWeek: 4, isOptional: false },
        ],
      },
    ]);
    expect(subjectUsage(overview, "missing")).toEqual([]);
    expect(gradeCounts(overview).get("eng")).toBe(2);
  });
});

describe("suggestSubjectCode", () => {
  it("uses the first three characters of a single word, in capitals", () => {
    expect(suggestSubjectCode("hindi")).toBe("HIN");
    expect(suggestSubjectCode("maths")).toBe("MAT");
    expect(suggestSubjectCode("  library ")).toBe("LIB");
    expect(suggestSubjectCode("SST")).toBe("SST");
    expect(suggestSubjectCode("PE")).toBe("PE");
  });
  it("uses initials for several words, ignoring punctuation", () => {
    expect(suggestSubjectCode("Computer Science")).toBe("CS");
    expect(suggestSubjectCode("physical education")).toBe("PE");
    expect(suggestSubjectCode("Arts & Crafts")).toBe("AC");
  });
  it("adds a number when the code is already taken", () => {
    expect(suggestSubjectCode("Maths", new Set(["MAT"]))).toBe("MAT2");
    expect(suggestSubjectCode("Material Science", new Set(["MS", "MS2"]))).toBe("MS3");
  });
  it("returns an empty code when the name has no letters or digits, and always a valid code otherwise", () => {
    expect(suggestSubjectCode("")).toBe("");
    expect(suggestSubjectCode(" - ")).toBe("");
    for (const name of ["hindi", "Computer Science", "Ünïcode Art", "2nd Language"]) {
      const code = suggestSubjectCode(name);
      if (code) expect(codeProblem(code)).toBeNull();
    }
  });
});
