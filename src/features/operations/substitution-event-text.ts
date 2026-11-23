import type { SubstitutionEvent } from "@/lib/api/schemas";

/** One readable sentence per substitution event type (types from GET /api/substitution-events). */
export function describeSubstitutionEvent(event: SubstitutionEvent): string {
  const absent = event.absentTeacher.name ?? "A teacher";
  const to = event.toTeacher?.name ?? "a substitute";
  const from = event.fromTeacher?.name ?? "the previous substitute";
  switch (event.type) {
    case "ABSENCE_RECORDED":
      return `${absent}’s absence was recorded.`;
    case "ABSENCE_CANCELLED":
      return `${absent}’s absence was cancelled.`;
    case "SUBSTITUTE_AUTO_ASSIGNED":
      return `${to} was assigned automatically to cover ${absent}.`;
    case "NO_SUBSTITUTE_AVAILABLE":
      return `No substitute could be assigned automatically for ${absent}. It needs attention.`;
    case "SUBSTITUTE_RELEASED":
      return `${from} was released from covering ${absent} and the lesson is open again.`;
    case "ASSIGNMENT_CHANGED":
      return `${to} was assigned to cover ${absent}.`;
    case "SUBSTITUTE_REPLACED":
      return `${to} replaced ${from} as cover for ${absent}.`;
    case "ASSIGNMENT_CANCELLED":
      return event.fromTeacher ? `${from}’s cover for ${absent} was removed.` : `A lesson needing cover for ${absent} was cancelled.`;
    case "COVER_OBSOLETED":
      return `A cover for ${absent} no longer applies because a new timetable was published.`;
    default:
      return `Substitution update for ${absent}.`;
  }
}
