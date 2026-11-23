/**
 * Domain types.
 *
 * RESPONSES come from the generated OpenAPI types (src/lib/api/openapi.gen.ts, generated from the audited
 * snapshot with --properties-required-by-default because Fastify response schemas never declare `required`).
 * Fastify strips undeclared response fields, so these match what the backend sends. Fields that the backend
 * only sends conditionally are made optional explicitly below (with the audit reference).
 *
 * REQUESTS are transcribed from the backend's Zod schemas (the authoritative validators; the OpenAPI request
 * schemas of several modules are documentation only). Each block names its source file.
 *
 * Substitution and curriculum responses have no OpenAPI response schema: see ./schemas.ts.
 */
import type { paths } from "./openapi.gen";

type Method = "get" | "post" | "put" | "patch" | "delete";
type JsonOf<R> = R extends { content: { "application/json": infer J } } ? J : never;
type SuccessJson<O> = O extends { responses: infer R }
  ? 200 extends keyof R
    ? JsonOf<R[200]>
    : 201 extends keyof R
      ? JsonOf<R[201]>
      : 202 extends keyof R
        ? JsonOf<R[202]>
        : never
  : never;

/** The `data` of the success response of an operation. */
export type ApiData<P extends keyof paths, M extends Method> = SuccessJson<NonNullable<paths[P][M]>> extends { data: infer D } ? D : never;

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type Item<T> = T extends readonly (infer U)[] ? U : never;

// ---------------------------------------------------------------- enums (prisma/schema.prisma)
export type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
export const DAYS_OF_WEEK: readonly DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export type AcademicYearStatus = "DRAFT" | "ACTIVE" | "COMPLETED";
export type SchoolType = "PRIMARY" | "SECONDARY" | "CUSTOM";
export type TeacherSubjectType = "PRIMARY" | "SECONDARY";
export type GradeScope = "SELECTED_GRADES" | "ALL_GRADES";
export type SectionScope = "ALL_SECTIONS" | "SELECTED_SECTIONS";
export type VersionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type ConsecutivePeriodPolicy = "ALLOW" | "PREFER_AVOID" | "NEVER_ALLOW";
export type LockMode = "KEEP" | "ALL" | "NONE";

// ---------------------------------------------------------------- responses: identity and school
export type Admin = ApiData<"/api/admin/me", "get">;
export type LoginResult = ApiData<"/api/admin/login", "post">;
export type School = ApiData<"/api/schools/{id}", "get">;
export type CreatedSchool = ApiData<"/api/schools", "post">;
export type RegisteredAdmin = ApiData<"/api/admin/register", "post">;

// ---------------------------------------------------------------- responses: structure
export type AcademicYear = ApiData<"/api/academic-years/{id}", "get">;
export type Grade = ApiData<"/api/grades/{id}", "get">;
export type Stream = ApiData<"/api/streams/{id}", "get">;
export type Section = ApiData<"/api/sections/{id}", "get">;
export type GradeStructureResult = ApiData<"/api/grades/bulk", "post">;
export type Subject = ApiData<"/api/subjects/{id}", "get">;
export type Teacher = ApiData<"/api/teachers/{id}", "get">;
export type TeacherListItem = Item<ApiData<"/api/teachers", "get">>;
export type TeacherSubjectLink = Item<ApiData<"/api/teachers/{teacherId}/subjects", "get">>;
export type GradeEligibility = Item<ApiData<"/api/teacher-subjects/{teacherSubjectId}/grades", "get">>;
export type SubjectRequirement = ApiData<"/api/subject-requirements/{id}", "get">;
export type SectionAssignment = ApiData<"/api/section-subject-teachers/{id}", "get">;
export type ScheduleConfig = ApiData<"/api/schedule-configs/{id}", "get">;
export type DeleteResult = ApiData<"/api/teachers/{id}", "delete">;

// ---------------------------------------------------------------- responses: timetabling
export type Feasibility = ApiData<"/api/timetable-feasibility", "get">;
export type FeasibilityIssue = Item<Feasibility["errors"]>;
/** sourceVersionId / lockedEntryCount are present only when options.sourceVersionId was sent (audit §1.11). */
export type GenerationAccepted = Optional<ApiData<"/api/timetable-generations", "post">, "sourceVersionId" | "lockedEntryCount">;
export type GenerationRun = ApiData<"/api/timetable-generations/{id}", "get">;
/** isStale / staleReason are present only with includeStaleness=true (audit §1.13). */
export type VersionSummary = Optional<Item<ApiData<"/api/timetable-versions", "get">>, "isStale" | "staleReason">;
export type VersionDetail = ApiData<"/api/timetable-versions/{id}", "get">;
export type VersionEntry = Item<VersionDetail["entries"]>;
export type TimetableView = ApiData<"/api/timetable-versions/{id}/timetable", "get">;
export type TimetableCell = Item<TimetableView["cells"]>;
export type Validation = ApiData<"/api/timetable-versions/{id}/validation", "get">;
export type MoveResult = ApiData<"/api/timetable-versions/{id}/moves", "post">;
export type LockResult = ApiData<"/api/timetable-versions/{id}/locks", "put">;
export type PublishResult = ApiData<"/api/timetable-versions/{id}/publish", "post">;
/** `staleness` is present only with includeStaleness:true (audit §5.6). */
export type CloneResult = Optional<ApiData<"/api/timetable-versions/{id}/clone", "post">, "staleness">;
export type DeleteVersionResult = ApiData<"/api/timetable-versions/{id}", "delete">;

// ---------------------------------------------------------------- requests (from backend Zod schemas)
// src/modules/admin/admin.schema.ts
export interface LoginBody { schoolId: string; email: string; password: string }
export interface RegisterAdminBody { schoolId: string; setupToken: string; name: string; email: string; password: string }
export interface CreateAdminBody { name: string; email: string; password: string }
// src/modules/school/school.schema.ts
export interface CreateSchoolBody { name: string; code: string; schoolType: SchoolType }
// src/modules/academic-year/academic-year.schema.ts
export interface CreateAcademicYearBody { name: string; startDate: string; endDate: string }
export interface UpdateAcademicYearBody { name?: string; startDate?: string; endDate?: string; status?: AcademicYearStatus }
// src/modules/grade/grade.schema.ts, grade-structure.schema.ts
export interface CreateGradeBody { academicYearId: string; name: string; displayOrder: number }
export interface UpdateGradeBody { name?: string; displayOrder?: number }
export interface BulkGradeStructureBody {
  academicYearId: string;
  grades: Array<{
    name: string;
    displayOrder: number;
    streams?: Array<{ name: string; code: string }>;
    sections?: Array<{ name: string; code: string; streamCode?: string }>;
  }>;
}
// src/modules/stream/stream.schema.ts
export interface CreateStreamBody { gradeId: string; name: string; code: string }
export interface UpdateStreamBody { name?: string; code?: string }
// src/modules/section/section.schema.ts
export interface CreateSectionBody { gradeId: string; streamId?: string; name: string; code: string }
export interface UpdateSectionBody { name?: string; code?: string }
// src/modules/subject/subject.schema.ts
export interface CreateSubjectBody { name: string; code: string }
export interface UpdateSubjectBody { name?: string; code?: string }
// src/modules/teacher/teacher.schema.ts  (employeeCode: null or "" clears; omitted = unchanged)
export interface CreateTeacherBody { name: string; employeeCode?: string | null; isActive?: boolean }
export interface UpdateTeacherBody { name?: string; employeeCode?: string | null; isActive?: boolean }
// src/modules/teacher-subject/teacher-subject.schema.ts
export interface CreateTeacherSubjectBody { subjectId: string; type: TeacherSubjectType; gradeScope?: GradeScope }
export interface UpdateTeacherSubjectBody { type?: TeacherSubjectType; gradeScope?: GradeScope }
// src/modules/subject-requirement/subject-requirement.schema.ts
export interface CreateRequirementBody {
  gradeId: string;
  streamId?: string | null;
  subjectId: string;
  periodsPerWeek: number;
  isOptional?: boolean;
  sectionScope?: SectionScope;
  sectionIds?: string[];
}
export interface UpdateRequirementBody { periodsPerWeek?: number; isOptional?: boolean; sectionScope?: SectionScope; sectionIds?: string[] }
// src/modules/curriculum/curriculum.schema.ts
export interface CurriculumLineBody { subjectId: string; periodsPerWeek: number; isOptional?: boolean; sectionScope?: SectionScope; sectionIds?: string[] }
export interface ReplaceCurriculumBody { streamId?: string | null; requirements: CurriculumLineBody[]; dryRun?: boolean }
export interface CopyCurriculumBody { fromGradeId: string; fromStreamId?: string | null; toGradeId: string; toStreamId?: string | null; dryRun?: boolean }
// src/modules/section-subject-teacher/section-subject-teacher.schema.ts
export interface CreateAssignmentBody { sectionId: string; subjectRequirementId: string; teacherId: string }
// src/modules/schedule-config/schedule-config.schema.ts (simplified model only; no clock times)
export interface CreateScheduleBody { academicYearId: string; workingDays: DayOfWeek[]; periodsPerDay: number; breakAfterPeriod: number }
export interface UpdateScheduleBody { workingDays?: DayOfWeek[]; periodsPerDay?: number; breakAfterPeriod?: number }
// src/modules/timetable-generation/timetable-generation.schema.ts
export interface StartGenerationBody {
  academicYearId: string;
  options?: { seed?: number; reproducible?: boolean; sourceVersionId?: string };
}
// src/modules/timetable-version/timetable-version.schema.ts
export interface MoveBody { entryId: string; to: { dayOfWeek: DayOfWeek; periodNumber: number }; swapWithEntryId?: string; expectedRevision: number }
export interface LocksBody { entryIds: string[]; locked: boolean; expectedRevision: number }
export interface PublishBody { expectedRevision: number; expectedPublishedVersionId: string | null }
export interface CloneBody { lockMode?: LockMode; includeStaleness?: boolean }
export interface DeleteArchivedVersionBody { confirmVersionNumber: number; expectedStatus: "ARCHIVED"; expectedRevision: number }
// src/modules/substitution/substitution.schema.ts (dates are YYYY-MM-DD UTC calendar dates; periods 1..12)
export type AbsenceScope = "FULL_DAY" | "PERIODS";
export interface CreateAbsenceBody {
  teacherId: string;
  startDate: string;
  endDate: string;
  scope?: AbsenceScope;
  fromPeriod?: number | null;
  toPeriod?: number | null;
  reason?: string | null;
  autoAssign?: boolean;
  allowTemporaryCover?: boolean;
}
export interface UpdateAbsenceBody {
  startDate?: string;
  endDate?: string;
  scope?: AbsenceScope;
  fromPeriod?: number | null;
  toPeriod?: number | null;
  reason?: string | null;
  autoAssign?: boolean;
  allowTemporaryCover?: boolean;
}
export interface CreateUnavailabilityBody { teacherId: string; date: string; periodNumber?: number | null; reason?: string | null }
export interface AssignCoverBody { teacherId: string; confirmFourConsecutive?: boolean }
export interface AutoAssignRangeBody { from?: string; to?: string; allowTemporaryCover?: boolean }
