import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as endpoints from "./endpoints";

/**
 * CAPABILITY-BOUNDARIES.md §4.1: the API layer exposes no function for a capability the backend lacks,
 * and calls no endpoint outside the audited inventory.
 */
// `removeArchived` (delete an ARCHIVED version, approved) is allowed; archiving/restoring a version is not.
const FORBIDDEN_NAME = /unpublish|archiveVersion|\.archive$|restore|export|download|workload|audit|activity|cancelGeneration|cancelRun|stopRun|resetPassword|changePassword|timezone|byCode|lookupSchool|addLesson|removeLesson|changeLessonTeacher|deletePublished|removePublished/i;

// Every path prefix in the audited inventory (PHASE-0-AUDIT §1; route table in phase-0-artifacts/routes.txt).
const AUDITED_PREFIXES = [
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/me",
  "/api/admin/register",
  "/api/admins",
  "/api/schools",
  "/api/academic-years",
  "/api/grades",
  "/api/streams",
  "/api/sections",
  "/api/subjects",
  "/api/curriculum",
  "/api/subject-requirements",
  "/api/teachers",
  "/api/teacher-subjects",
  "/api/section-subject-teachers",
  "/api/schedule-configs",
  "/api/timetable-feasibility",
  "/api/timetable-generations",
  "/api/timetable-versions",
  "/api/teacher-absences",
  "/api/teacher-unavailability",
  "/api/substitutions",
  "/api/substitution-settings",
  "/api/substitution-events",
];

describe("API boundary", () => {
  it("exposes no function named after an unsupported capability", () => {
    const names = Object.entries(endpoints).flatMap(([group, value]) =>
      typeof value === "object" && value !== null ? Object.keys(value).map((fn) => `${group}.${fn}`) : [group],
    );
    expect(names.length).toBeGreaterThan(60);
    expect(names.filter((name) => FORBIDDEN_NAME.test(name))).toEqual([]);
  });

  it("only calls audited endpoints", () => {
    const source = readFileSync(join(__dirname, "endpoints.ts"), "utf8");
    const paths = [...source.matchAll(/["`](\/api\/[^"`$?]*)/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(30);
    const unknown = paths.filter((p) => !AUDITED_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`)));
    expect(unknown).toEqual([]);
  });

  it("never calls the generation endpoints with a cancel/delete method", () => {
    const source = readFileSync(join(__dirname, "endpoints.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/"DELETE",\s*`\/api\/timetable-generations/);
    expect(source).not.toMatch(/\/publish\b[^\n]*"DELETE"|unpublish/);
  });
});
