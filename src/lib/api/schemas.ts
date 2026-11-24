/**
 * Hand-written response schemas for the backend modules WITHOUT OpenAPI response schemas
 * (substitution and curriculum; audit §1.5, §1.17). Built from the backend services and the live
 * captures in timetable-backend/e2e/dashboard/API_CONTRACTS.md (backend 64b3923).
 *
 * Objects are "loose" so an additive backend change never breaks the UI. `checked()` validates in
 * development and tests (logging mismatches) and always returns the data; the contract tests in
 * e2e/real/contracts.spec.ts parse strictly against the real backend.
 */
import { z } from "zod";

const uuid = z.string();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ref = z.looseObject({ id: uuid, name: z.string() });
const refCode = z.looseObject({ id: uuid, name: z.string(), code: z.string() });
const day = z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);

// ----------------------------------------------------------------- substitution
export const coverStatus = z.enum(["OPEN", "ASSIGNED", "CANCELLED", "OBSOLETE"]);
export const attentionSchema = z.looseObject({ code: z.string(), message: z.string().optional() }).nullable();

export const coverSchema = z.looseObject({
  id: uuid,
  date,
  dayOfWeek: day,
  periodNumber: z.number(),
  status: coverStatus,
  absenceId: uuid,
  timetableVersion: z.looseObject({ id: uuid, versionNumber: z.number(), status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]) }),
  section: z.looseObject({ id: uuid, name: z.string(), code: z.string(), gradeId: uuid }),
  subject: refCode,
  absentTeacher: ref,
  replacementTeacher: ref.nullable(),
  assignedById: uuid.nullable(),
  assignedAt: z.string().nullable(),
  cancelledById: uuid.nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  obsoleteAt: z.string().nullable(),
  supersedesId: uuid.nullable(),
  assignmentSource: z.enum(["MANUAL", "AUTOMATIC"]).nullable(),
  temporaryUnqualified: z.boolean(),
  attention: attentionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Cover = z.infer<typeof coverSchema>;

export const coverListSchema = z.looseObject({ total: z.number(), items: z.array(coverSchema) });
export type CoverList = z.infer<typeof coverListSchema>;

export const coverHistoryItemSchema = z.looseObject({
  id: uuid,
  action: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string(),
  fromTeacher: z.looseObject({ id: uuid, name: z.string().nullable() }).nullable(),
  toTeacher: z.looseObject({ id: uuid, name: z.string().nullable() }).nullable(),
  actor: z.looseObject({ id: uuid, name: z.string().nullable() }).nullable(),
  note: z.string().nullable(),
  details: z.unknown().nullable(),
  createdAt: z.string(),
});
export const coverDetailSchema = coverSchema.extend({ history: z.array(coverHistoryItemSchema) });
export type CoverDetail = z.infer<typeof coverDetailSchema>;

export const candidateSchema = z.looseObject({
  id: uuid,
  name: z.string(),
  employeeCode: z.string().nullable(),
  tier: z.number(),
  tierKey: z.enum(["SAME_SUBJECT", "OTHER_AVAILABLE", "LAST_RESORT"]),
  offered: z.boolean(),
  recommended: z.boolean(),
  requiresConfirmation: z.boolean(),
  subjectBasis: z.enum(["PRIMARY_LINK", "SECONDARY_LINK", "TEACHES_IN_TIMETABLE"]).nullable(),
  sameSubject: z.boolean(),
  gradeEligible: z.boolean(),
  weeklyLoad: z.number(),
  recentCovers: z.number(),
  temporaryUnqualified: z.boolean(),
  free: z.boolean(),
  coverLoadToday: z.number(),
  consecutive: z.looseObject({
    resultingRun: z.number(),
    from: z.number(),
    to: z.number(),
    periods: z.array(z.number()),
    createsFourConsecutive: z.boolean(),
    threshold: z.number(),
  }),
  explanation: z.string(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export const candidatesSchema = z.looseObject({
  coverRequestId: uuid,
  date,
  periodNumber: z.number(),
  candidates: z.array(candidateSchema),
  selection: z.looseObject({
    summary: z.string(),
    counts: z.looseObject({ SAME_SUBJECT: z.number(), OTHER_AVAILABLE: z.number(), LAST_RESORT: z.number() }),
    sameSubjectAvailable: z.boolean(),
    otherAvailable: z.boolean(),
    lastResortOffered: z.boolean(),
    notOffered: z.number(),
    recommendedTeacherId: uuid.nullable(),
  }),
  policy: z.enum(["ALLOW", "PREFER_AVOID", "NEVER_ALLOW"]),
  excludedCounts: z.record(z.string(), z.number()),
  message: z.string().optional(),
  excluded: z
    .array(
      z.looseObject({
        teacher: z.looseObject({ id: uuid, name: z.string(), employeeCode: z.string().nullable() }),
        reason: z.string(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});
export type Candidates = z.infer<typeof candidatesSchema>;

export const assignResultSchema = coverSchema.extend({
  selection: z
    .looseObject({
      tier: z.number(),
      tierKey: z.string(),
      sameSubject: z.boolean(),
      subjectBasis: z.string().nullable(),
      consecutive: z.looseObject({ resultingRun: z.number(), from: z.number(), to: z.number(), createsFourConsecutive: z.boolean() }),
    })
    .optional(),
});
export type AssignResult = z.infer<typeof assignResultSchema>;

export const absenceSchema = z.looseObject({
  id: uuid,
  teacherId: uuid,
  teacher: ref.optional(),
  startDate: date,
  endDate: date,
  scope: z.enum(["FULL_DAY", "PERIODS"]),
  fromPeriod: z.number().nullable(),
  toPeriod: z.number().nullable(),
  reason: z.string().nullable(),
  status: z.enum(["ACTIVE", "CANCELLED"]),
  createdById: uuid.nullable(),
  updatedById: uuid.nullable(),
  cancelledById: uuid.nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  covers: z.looseObject({ OPEN: z.number(), ASSIGNED: z.number(), CANCELLED: z.number(), OBSOLETE: z.number() }).optional(),
});
export type Absence = z.infer<typeof absenceSchema>;

export const autoRunSchema = z.looseObject({
  considered: z.number(),
  assigned: z.number(),
  unfilled: z.number(),
  conflicts: z.number(),
  skippedPast: z.number(),
  heldForReview: z.number(),
});
export type AutoRun = z.infer<typeof autoRunSchema>;

export const summaryCoverSchema = z.looseObject({
  id: uuid,
  absenceId: uuid,
  date,
  periodNumber: z.number(),
  status: coverStatus,
  section: ref,
  subject: ref,
  replacementTeacher: ref.nullable(),
  assignmentSource: z.enum(["MANUAL", "AUTOMATIC"]).nullable(),
  temporaryUnqualified: z.boolean(),
  attention: attentionSchema,
});
export const allocationSummarySchema = z.looseObject({
  totalAffectedLessons: z.number(),
  assigned: z.number(),
  automaticallyAssigned: z.number(),
  manuallyAssigned: z.number(),
  unfilled: z.number(),
  temporaryUnqualifiedCovers: z.number(),
  skippedPastDates: z.number(),
  needsAdminAttention: z.number(),
  covers: z.array(summaryCoverSchema),
});
export type AllocationSummary = z.infer<typeof allocationSummarySchema>;

export const automaticAllocationSchema = z.looseObject({
  enabled: z.boolean(),
  status: z.enum(["COMPLETED", "FAILED", "DISABLED"]),
  error: z.string().optional(),
  allowTemporaryCover: z.boolean(),
  run: autoRunSchema.nullable(),
  releasedAutomaticAssignments: z.number(),
});
export const createAbsenceResultSchema = z.looseObject({
  absence: absenceSchema,
  coverRequestsCreated: z.number(),
  datesWithoutPublishedTimetable: z.number(),
  ambiguousDates: z.array(z.string()),
  automaticAllocation: automaticAllocationSchema,
});
export type CreateAbsenceResult = z.infer<typeof createAbsenceResultSchema>;
export const updateAbsenceResultSchema = z.looseObject({
  absence: absenceSchema,
  coverRequestsCreated: z.number(),
  coverRequestsCancelled: z.number(),
  coverRequestsReopened: z.number(),
  automaticAllocation: automaticAllocationSchema,
});
export type UpdateAbsenceResult = z.infer<typeof updateAbsenceResultSchema>;
export const cancelAbsenceResultSchema = z.looseObject({
  absence: absenceSchema,
  coverRequestsCancelled: z.number(),
  automaticAssignmentsCancelled: z.number(),
});
export type CancelAbsenceResult = z.infer<typeof cancelAbsenceResultSchema>;
export const absenceAutoAssignResultSchema = allocationSummarySchema.extend({ allowTemporaryCover: z.boolean(), run: autoRunSchema });
export type AbsenceAutoAssignResult = z.infer<typeof absenceAutoAssignResultSchema>;
export const rangeAutoAssignResultSchema = z.looseObject({ allowTemporaryCover: z.boolean(), run: autoRunSchema });
export type RangeAutoAssignResult = z.infer<typeof rangeAutoAssignResultSchema>;

export const unavailabilitySchema = z.looseObject({
  id: uuid,
  teacherId: uuid,
  date,
  periodNumber: z.number().nullable(),
  wholeDay: z.boolean(),
  reason: z.string().nullable(),
  status: z.enum(["ACTIVE", "CANCELLED"]),
  createdById: uuid.nullable(),
  cancelledById: uuid.nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  automaticReallocation: automaticAllocationSchema.optional(),
});
export type Unavailability = z.infer<typeof unavailabilitySchema>;

export const substitutionSettingsSchema = z.looseObject({
  consecutivePeriodPolicy: z.enum(["ALLOW", "PREFER_AVOID", "NEVER_ALLOW"]),
  allowedValues: z.array(z.string()),
});
export type SubstitutionSettings = z.infer<typeof substitutionSettingsSchema>;

export const substitutionEventSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  occurredAt: z.string(),
  absenceId: uuid,
  coverRequestId: uuid.nullable(),
  date,
  periodNumber: z.number().nullable(),
  absentTeacher: z.looseObject({ id: uuid, name: z.string().nullable() }),
  fromTeacher: z.looseObject({ id: uuid, name: z.string().nullable() }).nullable(),
  toTeacher: z.looseObject({ id: uuid, name: z.string().nullable() }).nullable(),
  automatic: z.boolean(),
  message: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable(),
});
export type SubstitutionEvent = z.infer<typeof substitutionEventSchema>;
export const substitutionEventsSchema = z.looseObject({
  items: z.array(substitutionEventSchema),
  nextCursor: z.string().nullable(),
  nextSince: z.string().nullable(),
  hasMore: z.boolean(),
});
export type SubstitutionEvents = z.infer<typeof substitutionEventsSchema>;

// ----------------------------------------------------------------- curriculum
export const curriculumRequirementSchema = z.looseObject({
  id: uuid,
  subject: refCode,
  periodsPerWeek: z.number(),
  isOptional: z.boolean(),
  sectionScope: z.enum(["ALL_SECTIONS", "SELECTED_SECTIONS"]),
  sectionIds: z.array(uuid),
  appliesToSections: z.number(),
  classification: z.enum(["COMMON", "GRADE_SPECIFIC", "STREAM_SPECIFIC", "SECTION_SPECIFIC"]),
});
export type CurriculumRequirement = z.infer<typeof curriculumRequirementSchema>;
export const curriculumGroupSchema = z.looseObject({
  streamId: uuid.nullable(),
  stream: refCode.nullable(),
  label: z.string(),
  sectionCount: z.number(),
  sections: z.array(z.looseObject({ id: uuid, name: z.string(), code: z.string(), periodsPerWeek: z.number() })),
  requirements: z.array(curriculumRequirementSchema),
  totalPeriods: z.number(),
});
export type CurriculumGroup = z.infer<typeof curriculumGroupSchema>;
export const curriculumGradeSchema = z.looseObject({
  id: uuid,
  name: z.string(),
  displayOrder: z.number(),
  streamed: z.boolean(),
  streams: z.array(refCode),
  sectionCount: z.number(),
  curricula: z.array(curriculumGroupSchema),
});
export type CurriculumGrade = z.infer<typeof curriculumGradeSchema>;
export const curriculumIssueSchema = z.looseObject({
  code: z.enum(["GROUP_WITHOUT_CURRICULUM", "CURRICULUM_WITHOUT_SECTIONS", "SECTION_DEMAND_EXCEEDS_SLOTS", "MIXED_GRADE_MODE"]),
  severity: z.enum(["ERROR", "WARNING"]),
  gradeId: uuid,
  streamId: uuid.nullable(),
  sectionId: uuid.optional(),
  message: z.string(),
});
export type CurriculumIssue = z.infer<typeof curriculumIssueSchema>;
export const curriculumOverviewSchema = z.looseObject({
  academicYear: z.looseObject({ id: uuid, name: z.string(), status: z.enum(["DRAFT", "ACTIVE", "COMPLETED"]) }),
  weeklySlots: z.number().nullable(),
  grades: z.array(curriculumGradeSchema),
  subjects: z.array(
    z.looseObject({
      subject: refCode,
      usage: z.array(z.looseObject({ gradeId: uuid, streamId: uuid.nullable(), periodsPerWeek: z.number(), isOptional: z.boolean() })),
      gradeCount: z.number(),
    }),
  ),
  issues: z.array(curriculumIssueSchema),
});
export type CurriculumOverview = z.infer<typeof curriculumOverviewSchema>;

const planLine = z.looseObject({ subjectId: uuid, subjectName: z.string().optional(), periodsPerWeek: z.number().optional() });
export const curriculumPlanSchema = z.looseObject({
  create: z.array(planLine),
  update: z.array(
    z.looseObject({
      id: uuid,
      subjectId: uuid,
      subjectName: z.string(),
      changes: z.array(z.string()),
      from: z.looseObject({ periodsPerWeek: z.number().optional(), isOptional: z.boolean().optional(), sectionScope: z.string().optional(), sectionIds: z.array(uuid).optional() }).optional(),
      to: z.looseObject({ periodsPerWeek: z.number().optional(), isOptional: z.boolean().optional(), sectionScope: z.string().optional(), sectionIds: z.array(uuid).optional() }).optional(),
    }),
  ),
  remove: z.array(z.looseObject({ id: uuid, subjectId: uuid, subjectName: z.string(), periodsPerWeek: z.number() })),
  unchanged: z.number(),
});
export const replaceCurriculumResultSchema = z.looseObject({
  applied: z.boolean(),
  gradeId: uuid,
  streamId: uuid.nullable(),
  plan: curriculumPlanSchema,
});
export type ReplaceCurriculumResult = z.infer<typeof replaceCurriculumResultSchema>;
export const copyCurriculumResultSchema = z.looseObject({
  applied: z.boolean(),
  toGradeId: uuid,
  toStreamId: uuid.nullable(),
  created: z.array(z.looseObject({ subject: refCode, periodsPerWeek: z.number(), isOptional: z.boolean() })),
  skipped: z.array(z.looseObject({ subject: refCode, reason: z.enum(["ALREADY_REQUIRED", "SECTION_SPECIFIC_NOT_COPIED"]) })),
});
export type CopyCurriculumResult = z.infer<typeof copyCurriculumResultSchema>;

/** Validates in development/test and logs mismatches; never throws in production. */
export function checked<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  if (process.env.NODE_ENV !== "production") {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.error(`[api contract] ${label} did not match its schema`, result.error.issues.slice(0, 5));
    }
  }
  return data as T;
}
