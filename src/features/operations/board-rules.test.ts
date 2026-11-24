import { describe, expect, it } from "vitest";
import type { AcademicYear } from "@/lib/api/types";
import type { Cover } from "@/lib/api/schemas";
import { todayUtc, weekdayOf } from "@/lib/dates";
import {
  absenceScopeLabel,
  attentionText,
  boardHref,
  coverCounts,
  describeHistory,
  groupCovers,
  isReservedCancelReason,
  lessonsFromDetails,
  nextDay,
  overlappingAbsenceId,
  previousDay,
  relationToToday,
  resolveBoardDate,
  yearsContaining,
} from "./board-rules";

describe("date navigation (UTC calendar dates)", () => {
  it("moves across month, year and leap-day boundaries", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(previousDay("2026-12-01")).toBe("2026-11-30");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(previousDay("2027-03-01")).toBe("2027-02-28");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });

  it("uses the UTC date as today, not the browser's local date", () => {
    // 20:00 in New York on 23 Nov is already 24 Nov in UTC.
    expect(todayUtc(new Date("2026-11-23T20:00:00-05:00"))).toBe("2026-11-24");
    // 04:00 in India on 24 Nov is still 23 Nov in UTC.
    expect(todayUtc(new Date("2026-11-24T04:00:00+05:30"))).toBe("2026-11-23");
    expect(weekdayOf("2026-11-24")).toBe("TUESDAY");
  });

  it("falls back to today for a missing or invalid ?date=", () => {
    expect(resolveBoardDate(null, "2026-11-24")).toBe("2026-11-24");
    expect(resolveBoardDate("2026-02-30", "2026-11-24")).toBe("2026-11-24");
    expect(resolveBoardDate("tomorrow", "2026-11-24")).toBe("2026-11-24");
    expect(resolveBoardDate("2026-12-01", "2026-11-24")).toBe("2026-12-01");
  });

  it("relates a date to today and builds board links", () => {
    expect(relationToToday("2026-11-23", "2026-11-24")).toBe("past");
    expect(relationToToday("2026-11-24", "2026-11-24")).toBe("today");
    expect(relationToToday("2026-11-25", "2026-11-24")).toBe("future");
    expect(boardHref("2026-11-25", "abc")).toBe("/operations?date=2026-11-25&cover=abc");
    expect(boardHref("2026-11-25")).toBe("/operations?date=2026-11-25");
  });
});

describe("yearsContaining", () => {
  const year = (id: string, start: string, end: string, status: AcademicYear["status"]) =>
    ({ id, name: id, startDate: `${start}T00:00:00.000Z`, endDate: `${end}T00:00:00.000Z`, status }) as AcademicYear;
  const years = [year("old", "2025-04-01", "2026-03-31", "COMPLETED"), year("cur", "2026-04-01", "2027-03-31", "ACTIVE"), year("next", "2027-04-01", "2028-03-31", "DRAFT")];
  it("finds DRAFT/ACTIVE years whose dates include the day (inclusive)", () => {
    expect(yearsContaining(years, "2026-11-24").map((y) => y.id)).toEqual(["cur"]);
    expect(yearsContaining(years, "2027-03-31").map((y) => y.id)).toEqual(["cur"]);
    expect(yearsContaining(years, "2027-04-01").map((y) => y.id)).toEqual(["next"]);
    expect(yearsContaining(years, "2025-12-01")).toEqual([]);
  });
});

function cover(id: string, overrides: Partial<Cover>): Cover {
  return {
    id,
    date: "2026-11-24",
    dayOfWeek: "TUESDAY",
    periodNumber: 1,
    status: "OPEN",
    absenceId: "abs",
    section: { id: "s", name: "Section A", code: "A", gradeId: "g" },
    subject: { id: "sub", name: "Maths", code: "M" },
    absentTeacher: { id: "t1", name: "Zoe" },
    replacementTeacher: null,
    assignmentSource: null,
    temporaryUnqualified: false,
    attention: null,
    ...overrides,
  } as Cover;
}

describe("board grouping and counts", () => {
  const items = [
    cover("1", { periodNumber: 3, status: "ASSIGNED", replacementTeacher: { id: "r", name: "R" }, temporaryUnqualified: true }),
    cover("2", { periodNumber: 1, attention: { code: "NO_AVAILABLE_TEACHER", message: "No teacher is free" } }),
    cover("3", { periodNumber: 3, absentTeacher: { id: "t2", name: "Adam" }, section: { id: "s2", name: "Section B", code: "B", gradeId: "g" } }),
    cover("4", { periodNumber: 2, status: "CANCELLED" }),
  ];

  it("counts total, assigned, open, attention and temporary cover from the list", () => {
    expect(coverCounts(items)).toEqual({ total: 3, assigned: 1, open: 2, attention: 1, temporary: 1, closed: 1 });
  });

  it("groups by period ascending", () => {
    expect(groupCovers(items, "period").map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ["Period 1", ["2"]],
      ["Period 2", ["4"]],
      ["Period 3", ["1", "3"]],
    ]);
  });

  it("groups by absent teacher by name, lessons by period", () => {
    expect(groupCovers(items, "teacher").map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ["Adam", ["3"]],
      ["Zoe", ["2", "4", "1"]],
    ]);
  });

  it("prefers the backend's attention message", () => {
    expect(attentionText(null)).toBeNull();
    expect(attentionText({ code: "PAST_DATE", message: "" })).toBe("Date has passed");
    expect(attentionText({ code: "X", message: "Custom" })).toBe("Custom");
  });
});

describe("refusal details and labels", () => {
  it("strips the internal request id from errors.lessons", () => {
    expect(lessonsFromDetails({ lessons: ["9c0897e2-cd4d-4936-b9db-fa6c72617eaf: 2026-11-25 period 3, Section B Physics, substitute Neha (assigned by an admin)"] })).toEqual([
      "2026-11-25 period 3, Section B Physics, substitute Neha (assigned by an admin)",
    ]);
    expect(lessonsFromDetails({})).toEqual([]);
  });

  it("reads the overlapping absence id", () => {
    expect(overlappingAbsenceId({ absenceId: ["abc"] })).toBe("abc");
    expect(overlappingAbsenceId({})).toBeNull();
  });

  it("recognises reserved cancellation reasons case-insensitively", () => {
    expect(isReservedCancelReason(" absence_cancelled ")).toBe(true);
    expect(isReservedCancelReason("SUBSTITUTE_UNAVAILABLE")).toBe(true);
    expect(isReservedCancelReason("Field trip")).toBe(false);
  });

  it("labels scopes and history entries", () => {
    expect(absenceScopeLabel({ scope: "FULL_DAY", fromPeriod: null, toPeriod: null })).toBe("Full day");
    expect(absenceScopeLabel({ scope: "PERIODS", fromPeriod: 2, toPeriod: 4 })).toBe("Periods 2–4");
    expect(absenceScopeLabel({ scope: "PERIODS", fromPeriod: 3, toPeriod: 3 })).toBe("Period 3");
    const base = { id: "h", fromStatus: "ASSIGNED", toStatus: "ASSIGNED", actor: null, note: null, details: null, createdAt: "2026-11-24T00:00:00Z" };
    expect(describeHistory({ ...base, action: "REASSIGNED", fromTeacher: { id: "1", name: "A" }, toTeacher: { id: "2", name: "B" } })).toBe("Substitute replaced: A → B");
    expect(describeHistory({ ...base, action: "CREATED", fromTeacher: null, toTeacher: null })).toBe("Lesson needs cover");
  });
});
