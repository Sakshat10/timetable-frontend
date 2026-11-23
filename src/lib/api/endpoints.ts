/**
 * The complete frontend API surface. One function per backend operation in the audited inventory
 * (docs/architecture/PHASE-0-AUDIT.md §1; FEATURE-API-MATRIX.md). There are deliberately NO functions
 * for capabilities the backend does not have (CAPABILITY-BOUNDARIES.md §4.1): no generation cancel,
 * unpublish/archive/restore, lesson teacher change, lesson add/remove, export, workload, audit log,
 * password reset or school-code login. Deleting a PUBLISHED version is excluded (P6).
 */
import { api, apiEnvelope } from "./client";
import {
  absenceAutoAssignResultSchema,
  absenceSchema,
  allocationSummarySchema,
  assignResultSchema,
  cancelAbsenceResultSchema,
  candidatesSchema,
  checked,
  copyCurriculumResultSchema,
  coverDetailSchema,
  coverListSchema,
  coverSchema,
  createAbsenceResultSchema,
  curriculumOverviewSchema,
  rangeAutoAssignResultSchema,
  replaceCurriculumResultSchema,
  substitutionEventsSchema,
  substitutionSettingsSchema,
  unavailabilitySchema,
  updateAbsenceResultSchema,
} from "./schemas";
import type * as T from "./types";
import { z } from "zod";

const enc = encodeURIComponent;

// ------------------------------------------------------------------ auth and school (§1.1)
export const authApi = {
  login: (body: T.LoginBody) => api<T.LoginResult>("POST", "/api/admin/login", { body, skipUnauthorizedSignal: true }),
  logout: () => api<null>("POST", "/api/admin/logout", { skipUnauthorizedSignal: true }),
  me: () => api<T.Admin>("GET", "/api/admin/me"),
  register: (body: T.RegisterAdminBody) => api<T.RegisteredAdmin>("POST", "/api/admin/register", { body, skipUnauthorizedSignal: true }),
  createAdmin: (body: T.CreateAdminBody) => api<T.RegisteredAdmin>("POST", "/api/admins", { body }),
};

export const schoolApi = {
  create: (body: T.CreateSchoolBody) => api<T.CreatedSchool>("POST", "/api/schools", { body, skipUnauthorizedSignal: true }),
  get: (id: string) => api<T.School>("GET", `/api/schools/${enc(id)}`),
};

// ------------------------------------------------------------------ academic years (§1.2)
export const yearsApi = {
  list: () => api<T.AcademicYear[]>("GET", "/api/academic-years"),
  get: (id: string) => api<T.AcademicYear>("GET", `/api/academic-years/${enc(id)}`),
  create: (body: T.CreateAcademicYearBody) => api<T.AcademicYear>("POST", "/api/academic-years", { body }),
  update: (id: string, body: T.UpdateAcademicYearBody) => api<T.AcademicYear>("PATCH", `/api/academic-years/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/academic-years/${enc(id)}`),
};

// ------------------------------------------------------------------ classes (§1.3)
export const gradesApi = {
  list: (academicYearId: string) => api<T.Grade[]>("GET", "/api/grades", { query: { academicYearId } }),
  get: (id: string) => api<T.Grade>("GET", `/api/grades/${enc(id)}`),
  create: (body: T.CreateGradeBody) => api<T.Grade>("POST", "/api/grades", { body }),
  createStructure: (body: T.BulkGradeStructureBody) => api<T.GradeStructureResult>("POST", "/api/grades/bulk", { body }),
  update: (id: string, body: T.UpdateGradeBody) => api<T.Grade>("PATCH", `/api/grades/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/grades/${enc(id)}`),
  streams: (gradeId: string) => api<T.Stream[]>("GET", `/api/grades/${enc(gradeId)}/streams`),
  sections: (gradeId: string) => api<T.Section[]>("GET", `/api/grades/${enc(gradeId)}/sections`),
};

export const streamsApi = {
  get: (id: string) => api<T.Stream>("GET", `/api/streams/${enc(id)}`),
  create: (body: T.CreateStreamBody) => api<T.Stream>("POST", "/api/streams", { body }),
  update: (id: string, body: T.UpdateStreamBody) => api<T.Stream>("PATCH", `/api/streams/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/streams/${enc(id)}`),
};

export const sectionsApi = {
  get: (id: string) => api<T.Section>("GET", `/api/sections/${enc(id)}`),
  create: (body: T.CreateSectionBody) => api<T.Section>("POST", "/api/sections", { body }),
  update: (id: string, body: T.UpdateSectionBody) => api<T.Section>("PATCH", `/api/sections/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/sections/${enc(id)}`),
};

// ------------------------------------------------------------------ subjects (§1.4)
export const subjectsApi = {
  list: () => api<T.Subject[]>("GET", "/api/subjects"),
  get: (id: string) => api<T.Subject>("GET", `/api/subjects/${enc(id)}`),
  create: (body: T.CreateSubjectBody) => api<T.Subject>("POST", "/api/subjects", { body }),
  createMany: (subjects: T.CreateSubjectBody[]) => api<T.Subject[]>("POST", "/api/subjects/bulk", { body: { subjects } }),
  update: (id: string, body: T.UpdateSubjectBody) => api<T.Subject>("PATCH", `/api/subjects/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/subjects/${enc(id)}`),
};

// ------------------------------------------------------------------ curriculum and requirements (§1.5)
export const curriculumApi = {
  overview: async (academicYearId: string) =>
    checked(curriculumOverviewSchema, await api<unknown>("GET", "/api/curriculum", { query: { academicYearId } }), "GET /curriculum"),
  replace: async (gradeId: string, body: T.ReplaceCurriculumBody) =>
    checked(replaceCurriculumResultSchema, await api<unknown>("PUT", `/api/curriculum/grades/${enc(gradeId)}`, { body }), "PUT /curriculum/grades/:id"),
  copy: async (body: T.CopyCurriculumBody) =>
    checked(copyCurriculumResultSchema, await api<unknown>("POST", "/api/curriculum/copy", { body }), "POST /curriculum/copy"),
};

export const requirementsApi = {
  list: (query: { academicYearId?: string; gradeId?: string; streamId?: string }) =>
    api<T.SubjectRequirement[]>("GET", "/api/subject-requirements", { query }),
  get: (id: string) => api<T.SubjectRequirement>("GET", `/api/subject-requirements/${enc(id)}`),
  create: (body: T.CreateRequirementBody) => api<T.SubjectRequirement>("POST", "/api/subject-requirements", { body }),
  update: (id: string, body: T.UpdateRequirementBody) => api<T.SubjectRequirement>("PATCH", `/api/subject-requirements/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/subject-requirements/${enc(id)}`),
};

// ------------------------------------------------------------------ teachers and eligibility (§1.6, §1.7)
export const teachersApi = {
  list: (query: { isActive?: boolean } = {}) => api<T.TeacherListItem[]>("GET", "/api/teachers", { query }),
  get: (id: string) => api<T.Teacher>("GET", `/api/teachers/${enc(id)}`),
  create: (body: T.CreateTeacherBody) => api<T.Teacher>("POST", "/api/teachers", { body }),
  /** Atomic and idempotent: reuse the SAME key when retrying an uncertain attempt with the same rows. */
  createMany: async (teachers: T.CreateTeacherBody[], idempotencyKey: string) => {
    const envelope = await apiEnvelope<T.Teacher[]>("POST", "/api/teachers/bulk", {
      body: { teachers },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    return { teachers: envelope.data, replayed: envelope.body.replayed === true };
  },
  update: (id: string, body: T.UpdateTeacherBody) => api<T.Teacher>("PATCH", `/api/teachers/${enc(id)}`, { body }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/teachers/${enc(id)}`),
  subjects: (teacherId: string) => api<T.TeacherSubjectLink[]>("GET", `/api/teachers/${enc(teacherId)}/subjects`),
  linkSubject: (teacherId: string, body: T.CreateTeacherSubjectBody) =>
    api<T.TeacherSubjectLink>("POST", `/api/teachers/${enc(teacherId)}/subjects`, { body }),
};

export const teacherSubjectsApi = {
  update: (linkId: string, body: T.UpdateTeacherSubjectBody) => api<T.TeacherSubjectLink>("PATCH", `/api/teacher-subjects/${enc(linkId)}`, { body }),
  remove: (linkId: string) => api<T.DeleteResult>("DELETE", `/api/teacher-subjects/${enc(linkId)}`),
  /** Returns eligibility rows for EVERY academic year: filter by grade.academicYearId. */
  grades: (linkId: string) => api<T.GradeEligibility[]>("GET", `/api/teacher-subjects/${enc(linkId)}/grades`),
  addGrade: (linkId: string, gradeId: string) =>
    api<T.GradeEligibility>("POST", `/api/teacher-subjects/${enc(linkId)}/grades`, { body: { gradeId } }),
  removeGrade: (linkId: string, gradeId: string) => api<T.DeleteResult>("DELETE", `/api/teacher-subjects/${enc(linkId)}/grades/${enc(gradeId)}`),
};

// ------------------------------------------------------------------ section-specific assignments (§1.8)
export const assignmentsApi = {
  list: (query: { academicYearId?: string; gradeId?: string; sectionId?: string; subjectId?: string; teacherId?: string }) =>
    api<T.SectionAssignment[]>("GET", "/api/section-subject-teachers", { query }),
  get: (id: string) => api<T.SectionAssignment>("GET", `/api/section-subject-teachers/${enc(id)}`),
  create: (body: T.CreateAssignmentBody) => api<T.SectionAssignment>("POST", "/api/section-subject-teachers", { body }),
  changeTeacher: (id: string, teacherId: string) =>
    api<T.SectionAssignment>("PATCH", `/api/section-subject-teachers/${enc(id)}`, { body: { teacherId } }),
  remove: (id: string) => api<T.DeleteResult>("DELETE", `/api/section-subject-teachers/${enc(id)}`),
};

// ------------------------------------------------------------------ schedule (§1.9, simplified model only)
export const scheduleApi = {
  list: (academicYearId: string) => api<T.ScheduleConfig[]>("GET", "/api/schedule-configs", { query: { academicYearId } }),
  get: (id: string) => api<T.ScheduleConfig>("GET", `/api/schedule-configs/${enc(id)}`),
  create: (body: T.CreateScheduleBody) => api<T.ScheduleConfig>("POST", "/api/schedule-configs", { body }),
  update: (id: string, body: T.UpdateScheduleBody) => api<T.ScheduleConfig>("PATCH", `/api/schedule-configs/${enc(id)}`, { body }),
  reset: (id: string) => api<T.DeleteResult>("DELETE", `/api/schedule-configs/${enc(id)}`),
};

// ------------------------------------------------------------------ feasibility and generation (§1.10-1.12)
export const feasibilityApi = {
  get: (academicYearId: string) => api<T.Feasibility>("GET", "/api/timetable-feasibility", { query: { academicYearId } }),
};

export const generationApi = {
  /** Not idempotent: on an uncertain outcome, read `list` instead of re-sending (audit §4.4). There is no cancel. */
  start: (body: T.StartGenerationBody) => api<T.GenerationAccepted>("POST", "/api/timetable-generations", { body }),
  get: (id: string) => api<T.GenerationRun>("GET", `/api/timetable-generations/${enc(id)}`),
  list: (academicYearId: string, limit = 20) => api<T.GenerationRun[]>("GET", "/api/timetable-generations", { query: { academicYearId, limit } }),
};

// ------------------------------------------------------------------ versions (§1.13, §5)
export const versionsApi = {
  list: (academicYearId: string, options: { status?: T.VersionStatus[]; includeStaleness?: boolean } = {}) =>
    api<T.VersionSummary[]>("GET", "/api/timetable-versions", {
      query: { academicYearId, status: options.status, includeStaleness: options.includeStaleness ? "true" : undefined },
    }),
  get: (id: string) => api<T.VersionDetail>("GET", `/api/timetable-versions/${enc(id)}`),
  view: (id: string, view: "section" | "teacher", entityId: string) =>
    api<T.TimetableView>("GET", `/api/timetable-versions/${enc(id)}/timetable`, { query: { view, id: entityId } }),
  validation: (id: string) => api<T.Validation>("GET", `/api/timetable-versions/${enc(id)}/validation`),
  /** Move within the lesson's own section, or swap two lessons of the same section. */
  move: (id: string, body: T.MoveBody) => apiEnvelope<T.MoveResult>("POST", `/api/timetable-versions/${enc(id)}/moves`, { body }),
  setLocks: (id: string, body: T.LocksBody) => apiEnvelope<T.LockResult>("PUT", `/api/timetable-versions/${enc(id)}/locks`, { body }),
  publish: (id: string, body: T.PublishBody) => api<T.PublishResult>("POST", `/api/timetable-versions/${enc(id)}/publish`, { body }),
  /** "Copy to new draft". Not idempotent. */
  clone: (id: string, body: T.CloneBody) => api<T.CloneResult>("POST", `/api/timetable-versions/${enc(id)}/clone`, { body }),
  /** DRAFT versions: no body at all (an empty object is a 400). */
  removeDraft: (id: string) => api<T.DeleteVersionResult>("DELETE", `/api/timetable-versions/${enc(id)}`),
  /** ARCHIVED versions only, with typed confirmation. Deleting the PUBLISHED version is intentionally not offered (P6). */
  removeArchived: (id: string, body: T.DeleteArchivedVersionBody) =>
    api<T.DeleteVersionResult>("DELETE", `/api/timetable-versions/${enc(id)}`, { body }),
};

// ------------------------------------------------------------------ daily operations (§1.17, §6)
export const absencesApi = {
  list: async (query: { teacherId?: string; status?: "ACTIVE" | "CANCELLED"; from?: string; to?: string } = {}) =>
    checked(z.array(absenceSchema), await api<unknown>("GET", "/api/teacher-absences", { query }), "GET /teacher-absences"),
  get: async (id: string) => checked(absenceSchema, await api<unknown>("GET", `/api/teacher-absences/${enc(id)}`), "GET /teacher-absences/:id"),
  /** Not idempotent: on an uncertain outcome re-read the list (audit §6). */
  create: async (body: T.CreateAbsenceBody) =>
    checked(createAbsenceResultSchema, await api<unknown>("POST", "/api/teacher-absences", { body }), "POST /teacher-absences"),
  update: async (id: string, body: T.UpdateAbsenceBody) =>
    checked(updateAbsenceResultSchema, await api<unknown>("PATCH", `/api/teacher-absences/${enc(id)}`, { body }), "PATCH /teacher-absences/:id"),
  cancel: async (id: string) =>
    checked(cancelAbsenceResultSchema, await api<unknown>("POST", `/api/teacher-absences/${enc(id)}/cancel`), "POST /teacher-absences/:id/cancel"),
  autoAssign: async (id: string, allowTemporaryCover?: boolean) =>
    checked(
      absenceAutoAssignResultSchema,
      await api<unknown>("POST", `/api/teacher-absences/${enc(id)}/auto-assign`, { body: allowTemporaryCover === undefined ? {} : { allowTemporaryCover } }),
      "POST /teacher-absences/:id/auto-assign",
    ),
  summary: async (id: string) =>
    checked(allocationSummarySchema, await api<unknown>("GET", `/api/teacher-absences/${enc(id)}/substitution-summary`), "GET summary"),
};

export const unavailabilityApi = {
  list: async (query: { teacherId?: string; from?: string; to?: string; status?: "ACTIVE" | "CANCELLED" } = {}) =>
    checked(z.array(unavailabilitySchema), await api<unknown>("GET", "/api/teacher-unavailability", { query }), "GET /teacher-unavailability"),
  create: async (body: T.CreateUnavailabilityBody) =>
    checked(unavailabilitySchema, await api<unknown>("POST", "/api/teacher-unavailability", { body }), "POST /teacher-unavailability"),
  cancel: async (id: string) =>
    checked(unavailabilitySchema, await api<unknown>("DELETE", `/api/teacher-unavailability/${enc(id)}`), "DELETE /teacher-unavailability/:id"),
};

export interface CoverQuery {
  from?: string;
  to?: string;
  status?: Array<"OPEN" | "ASSIGNED" | "CANCELLED" | "OBSOLETE">;
  absentTeacherId?: string;
  replacementTeacherId?: string;
  absenceId?: string;
  limit?: number;
  offset?: number;
}

/** Note: these reads run the backend's substitution sync, which may write (audit §1.17 R*). Do not poll aggressively. */
export const coversApi = {
  list: async (query: CoverQuery) => checked(coverListSchema, await api<unknown>("GET", "/api/substitutions", { query: { ...query } }), "GET /substitutions"),
  get: async (id: string) => checked(coverDetailSchema, await api<unknown>("GET", `/api/substitutions/${enc(id)}`), "GET /substitutions/:id"),
  candidates: async (id: string) =>
    checked(candidatesSchema, await api<unknown>("GET", `/api/substitutions/${enc(id)}/candidates`, { query: { includeExcluded: "true" } }), "GET candidates"),
  assign: async (id: string, body: T.AssignCoverBody) =>
    checked(assignResultSchema, await api<unknown>("PUT", `/api/substitutions/${enc(id)}/assignment`, { body }), "PUT assignment"),
  unassign: async (id: string) => checked(coverSchema, await api<unknown>("DELETE", `/api/substitutions/${enc(id)}/assignment`), "DELETE assignment"),
  cancel: async (id: string, reason?: string) =>
    checked(coverSchema, await api<unknown>("POST", `/api/substitutions/${enc(id)}/cancel`, { body: reason ? { reason } : {} }), "POST cancel"),
  autoAssignRange: async (body: T.AutoAssignRangeBody) =>
    checked(rangeAutoAssignResultSchema, await api<unknown>("POST", "/api/substitutions/auto-assign", { body }), "POST auto-assign"),
};

export const substitutionSettingsApi = {
  get: async () => checked(substitutionSettingsSchema, await api<unknown>("GET", "/api/substitution-settings"), "GET settings"),
  update: async (consecutivePeriodPolicy: T.ConsecutivePeriodPolicy) =>
    checked(substitutionSettingsSchema, await api<unknown>("PUT", "/api/substitution-settings", { body: { consecutivePeriodPolicy } }), "PUT settings"),
};

export const substitutionEventsApi = {
  page: async (query: { since?: string; cursor?: string; limit?: number }) =>
    checked(substitutionEventsSchema, await api<unknown>("GET", "/api/substitution-events", { query }), "GET /substitution-events"),
};
