"use client";

import { useQuery } from "@tanstack/react-query";
import { assignmentsApi, curriculumApi, feasibilityApi, scheduleApi, subjectsApi, teachersApi, versionsApi } from "@/lib/api/endpoints";
import { qk } from "@/lib/query/keys";

/** Parallel reads behind the dashboard and the setup guide. Each query fails independently. */
export function useSetupData(yearId: string) {
  const schedule = useQuery({ queryKey: qk.schedule(yearId), queryFn: () => scheduleApi.list(yearId) });
  const curriculum = useQuery({ queryKey: qk.curriculum(yearId), queryFn: () => curriculumApi.overview(yearId) });
  const subjects = useQuery({ queryKey: qk.subjects(), queryFn: subjectsApi.list });
  const teachers = useQuery({ queryKey: qk.teachers(), queryFn: () => teachersApi.list() });
  const assignments = useQuery({ queryKey: qk.assignments(yearId), queryFn: () => assignmentsApi.list({ academicYearId: yearId }) });
  const feasibility = useQuery({ queryKey: qk.feasibility(yearId), queryFn: () => feasibilityApi.get(yearId), staleTime: 15_000 });
  const versions = useQuery({
    queryKey: qk.versionsWithStaleness(yearId),
    queryFn: () => versionsApi.list(yearId, { includeStaleness: true }),
  });
  const all = [schedule, curriculum, subjects, teachers, assignments, feasibility, versions];
  return {
    schedule,
    curriculum,
    subjects,
    teachers,
    assignments,
    feasibility,
    versions,
    isPending: all.some((q) => q.isPending),
    failed: all.filter((q) => q.isError).length,
    refetchAll: () => Promise.all(all.map((q) => q.refetch())),
  };
}
