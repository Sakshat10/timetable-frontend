"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentsApi, curriculumApi, teacherSubjectsApi, teachersApi } from "@/lib/api/endpoints";
import type { CreateAssignmentBody, GradeEligibility, TeacherListItem, TeacherSubjectLink } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import { invalidateGenerationInput } from "@/features/teachers/hooks";

export function useCurriculumOverview(yearId: string) {
  return useQuery({ queryKey: qk.curriculum(yearId), queryFn: () => curriculumApi.overview(yearId) });
}

export function useYearAssignments(yearId: string) {
  return useQuery({ queryKey: qk.assignments(yearId), queryFn: () => assignmentsApi.list({ academicYearId: yearId }) });
}

/**
 * The data needed to build pin candidates for one subject: the subject links of every teacher qualified for it
 * (for gradeScope and the link id) and the grade-eligibility rows of SELECTED_GRADES links. Loaded only while the picker is open.
 */
export function useCandidateData(teachers: readonly TeacherListItem[] | undefined, subjectId: string | null) {
  const qualified = subjectId ? (teachers ?? []).filter((t) => t.isActive && t.subjects.some((s) => s.id === subjectId)) : [];
  const links = useQueries({
    queries: qualified.map((t) => ({ queryKey: qk.teacherLinks(t.id), queryFn: () => teachersApi.subjects(t.id) })),
    combine: (results) => ({
      byTeacher: new Map<string, TeacherSubjectLink[] | undefined>(qualified.map((t, i) => [t.id, results[i]?.data])),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => Promise.all(results.map((r) => r.refetch())),
    }),
  });
  const selectedLinks = [...links.byTeacher.values()]
    .flatMap((list) => list ?? [])
    .filter((l) => l.subjectId === subjectId && l.gradeScope === "SELECTED_GRADES");
  const grades = useQueries({
    queries: selectedLinks.map((l) => ({ queryKey: qk.linkGrades(l.id), queryFn: () => teacherSubjectsApi.grades(l.id) })),
    combine: (results) => ({
      byLink: new Map<string, GradeEligibility[] | undefined>(selectedLinks.map((l, i) => [l.id, results[i]?.data])),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => Promise.all(results.map((r) => r.refetch())),
    }),
  });
  return {
    linksByTeacher: links.byTeacher,
    gradesByLink: grades.byLink,
    error: links.error ?? grades.error,
    refetch: () => Promise.all([links.refetch(), grades.refetch()]),
  };
}

function useAfterPinWrite(yearId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([client.invalidateQueries({ queryKey: qk.assignments(yearId) }), invalidateGenerationInput(client, yearId)]);
}

export function useCreatePin(yearId: string) {
  const after = useAfterPinWrite(yearId);
  return useMutation({ mutationFn: (body: CreateAssignmentBody) => assignmentsApi.create(body), onSettled: after });
}

export function useRepin(yearId: string) {
  const after = useAfterPinWrite(yearId);
  return useMutation({
    mutationFn: ({ id, teacherId }: { id: string; teacherId: string }) => assignmentsApi.changeTeacher(id, teacherId),
    onSettled: after,
  });
}

export function useUnpin(yearId: string) {
  const after = useAfterPinWrite(yearId);
  return useMutation({ mutationFn: (id: string) => assignmentsApi.remove(id), onSettled: after });
}
