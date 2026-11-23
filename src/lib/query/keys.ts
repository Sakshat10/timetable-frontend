/**
 * Every TanStack Query key in the application (FRONTEND-ARCHITECTURE.md §7).
 * Keys are hierarchical so invalidating a prefix (e.g. ["versions", yearId]) refreshes every dependent query.
 */
export const qk = {
  me: () => ["me"] as const,
  school: (id: string) => ["school", id] as const,

  years: () => ["years"] as const,
  year: (id: string) => ["years", id] as const,

  curriculum: (yearId: string) => ["curriculum", yearId] as const,
  grades: (yearId: string) => ["grades", yearId] as const,
  gradeSections: (gradeId: string) => ["grade", gradeId, "sections"] as const,
  gradeStreams: (gradeId: string) => ["grade", gradeId, "streams"] as const,
  requirements: (yearId: string) => ["requirements", yearId] as const,

  subjects: () => ["subjects"] as const,
  teachers: () => ["teachers"] as const,
  teacher: (id: string) => ["teachers", id] as const,
  teacherLinks: (teacherId: string) => ["teachers", teacherId, "links"] as const,
  linkGrades: (linkId: string) => ["teacher-links", linkId, "grades"] as const,

  assignments: (yearId: string) => ["assignments", yearId] as const,
  schedule: (yearId: string) => ["schedule", yearId] as const,

  feasibility: (yearId: string) => ["feasibility", yearId] as const,
  runs: (yearId: string) => ["runs", yearId] as const,
  run: (runId: string) => ["run", runId] as const,

  versions: (yearId: string) => ["versions", yearId] as const,
  versionsWithStaleness: (yearId: string) => ["versions", yearId, "staleness"] as const,
  version: (versionId: string) => ["version", versionId] as const,
  view: (versionId: string, view: "section" | "teacher", entityId: string) => ["version", versionId, "view", view, entityId] as const,
  validation: (versionId: string) => ["version", versionId, "validation"] as const,

  covers: (filters: Record<string, unknown>) => ["covers", filters] as const,
  coversAll: () => ["covers"] as const,
  cover: (id: string) => ["cover", id] as const,
  candidates: (coverId: string) => ["cover", coverId, "candidates"] as const,
  absences: (filters: Record<string, unknown>) => ["absences", filters] as const,
  absencesAll: () => ["absences"] as const,
  absence: (id: string) => ["absence", id] as const,
  absenceSummary: (id: string) => ["absence", id, "summary"] as const,
  unavailability: (filters: Record<string, unknown>) => ["unavailability", filters] as const,
  unavailabilityAll: () => ["unavailability"] as const,
  substitutionSettings: () => ["substitution-settings"] as const,
  substitutionEvents: () => ["substitution-events"] as const,
};
