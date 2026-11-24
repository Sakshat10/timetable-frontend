import { describe, expect, it } from "vitest";
import type { SubstitutionEvent } from "@/lib/api/schemas";
import { describeSubstitutionEvent } from "./substitution-event-text";

const teacher = (name: string | null) => ({ id: `id-${name}`, name });

function event(type: string, overrides: Partial<SubstitutionEvent> = {}): SubstitutionEvent {
  return {
    id: "e1",
    type,
    occurredAt: "2026-11-24T08:00:00.000Z",
    absenceId: "a1",
    coverRequestId: "c1",
    date: "2026-11-24",
    periodNumber: 3,
    absentTeacher: teacher("Imran Khan"),
    fromTeacher: null,
    toTeacher: null,
    automatic: false,
    details: null,
    ...overrides,
  };
}

describe("describeSubstitutionEvent", () => {
  it("describes every event type the feed emits", () => {
    expect(describeSubstitutionEvent(event("ABSENCE_RECORDED"))).toBe("Imran Khan’s absence was recorded.");
    expect(describeSubstitutionEvent(event("ABSENCE_CANCELLED"))).toBe("Imran Khan’s absence was cancelled.");
    expect(describeSubstitutionEvent(event("SUBSTITUTE_AUTO_ASSIGNED", { toTeacher: teacher("Neha Gupta"), automatic: true }))).toBe(
      "Neha Gupta was assigned automatically to cover Imran Khan.",
    );
    expect(describeSubstitutionEvent(event("NO_SUBSTITUTE_AVAILABLE"))).toContain("needs attention");
    expect(describeSubstitutionEvent(event("SUBSTITUTE_RELEASED", { fromTeacher: teacher("Neha Gupta") }))).toBe(
      "Neha Gupta was released from covering Imran Khan and the lesson is open again.",
    );
    expect(describeSubstitutionEvent(event("ASSIGNMENT_CHANGED", { toTeacher: teacher("Neha Gupta") }))).toBe("Neha Gupta was assigned to cover Imran Khan.");
    expect(describeSubstitutionEvent(event("SUBSTITUTE_REPLACED", { fromTeacher: teacher("A"), toTeacher: teacher("B") }))).toBe("B replaced A as cover for Imran Khan.");
    expect(describeSubstitutionEvent(event("ASSIGNMENT_CANCELLED", { fromTeacher: teacher("A") }))).toBe("A’s cover for Imran Khan was removed.");
    expect(describeSubstitutionEvent(event("ASSIGNMENT_CANCELLED"))).toBe("A lesson needing cover for Imran Khan was cancelled.");
    expect(describeSubstitutionEvent(event("COVER_OBSOLETED"))).toContain("new timetable was published");
  });

  it("falls back safely for missing names and unknown types", () => {
    expect(describeSubstitutionEvent(event("ABSENCE_RECORDED", { absentTeacher: teacher(null) }))).toBe("A teacher’s absence was recorded.");
    expect(describeSubstitutionEvent(event("SUBSTITUTE_AUTO_ASSIGNED"))).toBe("A substitute was assigned automatically to cover Imran Khan.");
    expect(describeSubstitutionEvent(event("SOMETHING_NEW"))).toBe("Substitution update for Imran Khan.");
  });

  it("never uses audit or activity log wording", () => {
    for (const type of ["ABSENCE_RECORDED", "SUBSTITUTE_REPLACED", "COVER_OBSOLETED", "UNKNOWN"]) {
      expect(describeSubstitutionEvent(event(type))).not.toMatch(/audit|activity log|workload/i);
    }
  });
});
