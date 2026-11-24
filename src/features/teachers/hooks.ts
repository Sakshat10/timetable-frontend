"use client";

import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { assignmentsApi, gradesApi, subjectsApi, teacherSubjectsApi, teachersApi } from "@/lib/api/endpoints";
import type { CreateTeacherBody, CreateTeacherSubjectBody, TeacherSubjectLink, UpdateTeacherBody, UpdateTeacherSubjectBody } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";

/** Local keys, nested under the shared prefixes so the documented invalidations cover them. */
export const teacherKeys = {
  yearAssignments: (yearId: string, teacherId: string) => [...qk.assignments(yearId), { teacherId }] as const,
};

/** Generation input changed: readiness, curriculum summary and version staleness must be re-read. */
export function invalidateGenerationInput(client: QueryClient, yearId: string) {
  return Promise.all([
    client.invalidateQueries({ queryKey: qk.feasibility(yearId) }),
    client.invalidateQueries({ queryKey: qk.curriculum(yearId) }),
    client.invalidateQueries({ queryKey: ["versions", yearId] }),
  ]);
}

export function useTeachers() {
  return useQuery({ queryKey: qk.teachers(), queryFn: () => teachersApi.list() });
}

export function useTeacher(id: string) {
  return useQuery({ queryKey: qk.teacher(id), queryFn: () => teachersApi.get(id) });
}

export function useTeacherLinks(teacherId: string | null) {
  return useQuery({
    queryKey: qk.teacherLinks(teacherId ?? ""),
    queryFn: () => teachersApi.subjects(teacherId ?? ""),
    enabled: Boolean(teacherId),
  });
}

/** Grade-eligibility rows for each SELECTED_GRADES link (rows of every year; filter with rowsForYear). */
export function useLinkGrades(links: readonly Pick<TeacherSubjectLink, "id" | "gradeScope">[] | undefined, enabled = true) {
  const selected = (links ?? []).filter((link) => link.gradeScope === "SELECTED_GRADES");
  return useQueries({
    queries: selected.map((link) => ({
      queryKey: qk.linkGrades(link.id),
      queryFn: () => teacherSubjectsApi.grades(link.id),
      enabled,
    })),
    combine: (results) => ({
      byLink: new Map(selected.map((link, index) => [link.id, results[index]?.data])),
      pending: results.some((r) => r.isPending),
      error: results.find((r) => r.error)?.error ?? null,
      refetch: () => Promise.all(results.map((r) => r.refetch())),
    }),
  });
}

export function useSubjects() {
  return useQuery({ queryKey: qk.subjects(), queryFn: () => subjectsApi.list() });
}

export function useYearGrades(yearId: string) {
  return useQuery({ queryKey: qk.grades(yearId), queryFn: () => gradesApi.list(yearId) });
}

export function useTeacherYearAssignments(yearId: string, teacherId: string) {
  return useQuery({
    queryKey: teacherKeys.yearAssignments(yearId, teacherId),
    queryFn: () => assignmentsApi.list({ academicYearId: yearId, teacherId }),
  });
}

// ------------------------------------------------------------------ writes

/** After any teacher write: every teacher query (list, detail, links) and assignments (they embed the teacher). */
async function afterTeacherWrite(client: QueryClient, yearId: string, affectsGeneration: boolean) {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.teachers() }),
    client.invalidateQueries({ queryKey: qk.assignments(yearId) }),
    affectsGeneration ? invalidateGenerationInput(client, yearId) : Promise.resolve(),
  ]);
}

export function useCreateTeacher(yearId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTeacherBody) => teachersApi.create(body),
    onSettled: () => afterTeacherWrite(client, yearId, false),
  });
}

export function useCreateTeachers(yearId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ rows, key }: { rows: CreateTeacherBody[]; key: string }) => teachersApi.createMany(rows, key),
    onSettled: () => afterTeacherWrite(client, yearId, false),
  });
}

export function useUpdateTeacher(yearId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTeacherBody }) => teachersApi.update(id, body),
    onSettled: (_data, _error, { body }) => afterTeacherWrite(client, yearId, body.isActive !== undefined),
  });
}

export function useDeleteTeacher(yearId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => teachersApi.remove(id),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: qk.teacher(id), exact: true });
    },
    onSettled: () => afterTeacherWrite(client, yearId, true),
  });
}

async function afterLinkWrite(client: QueryClient, yearId: string, teacherId: string, linkId?: string) {
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.teacherLinks(teacherId) }),
    client.invalidateQueries({ queryKey: qk.teachers() }),
    linkId ? client.invalidateQueries({ queryKey: qk.linkGrades(linkId) }) : Promise.resolve(),
    invalidateGenerationInput(client, yearId),
  ]);
}

export function useLinkSubject(yearId: string, teacherId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTeacherSubjectBody) => teachersApi.linkSubject(teacherId, body),
    onSettled: () => afterLinkWrite(client, yearId, teacherId),
  });
}

export function useUpdateLink(yearId: string, teacherId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, body }: { linkId: string; body: UpdateTeacherSubjectBody }) => teacherSubjectsApi.update(linkId, body),
    onSettled: (_d, _e, { linkId }) => afterLinkWrite(client, yearId, teacherId, linkId),
  });
}

export function useRemoveLink(yearId: string, teacherId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => teacherSubjectsApi.remove(linkId),
    onSettled: (_d, _e, linkId) => afterLinkWrite(client, yearId, teacherId, linkId),
  });
}

export function useToggleGrade(yearId: string, teacherId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, gradeId, eligible }: { linkId: string; gradeId: string; eligible: boolean }) =>
      eligible ? teacherSubjectsApi.addGrade(linkId, gradeId) : teacherSubjectsApi.removeGrade(linkId, gradeId),
    onSettled: (_d, _e, { linkId }) =>
      Promise.all([
        client.invalidateQueries({ queryKey: qk.linkGrades(linkId) }),
        client.invalidateQueries({ queryKey: qk.teacherLinks(teacherId) }),
        invalidateGenerationInput(client, yearId),
      ]),
  });
}
