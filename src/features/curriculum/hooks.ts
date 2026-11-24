"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { curriculumApi, subjectsApi, versionsApi } from "@/lib/api/endpoints";
import { qk } from "@/lib/query/keys";

/**
 * The year's structure and curriculum read model (GET /curriculum): grades → streams → sections with
 * counts, requirements, subject usage and issues. Shared by the Classes, Subjects and Curriculum pages.
 */
export function useCurriculumOverview(yearId: string) {
  return useQuery({ queryKey: qk.curriculum(yearId), queryFn: () => curriculumApi.overview(yearId) });
}

/** School-wide subjects (not year-scoped). */
export function useSubjects() {
  return useQuery({ queryKey: qk.subjects(), queryFn: subjectsApi.list });
}

/**
 * Number of timetable drafts in the year (same key and request as the setup guide, so the cache is shared).
 * Used only to warn that setup changes make those drafts out of date.
 */
export function useDraftCount(yearId: string): number {
  const { data } = useQuery({
    queryKey: qk.versionsWithStaleness(yearId),
    queryFn: () => versionsApi.list(yearId, { includeStaleness: true }),
    staleTime: 30_000,
  });
  return data ? data.filter((v) => v.status === "DRAFT").length : 0;
}

/**
 * Invalidation after a setup write that changes the generation input (IMPLEMENTATION-GUIDE "Setup changes
 * affect drafts"). `subjects` also refreshes the school-wide subject list and every year's curriculum
 * (subject names and codes appear there).
 */
export function useInvalidateSetup(yearId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (options: { subjects?: boolean } = {}) => {
      const keys: ReadonlyArray<readonly unknown[]> = [
        options.subjects ? ["curriculum"] : qk.curriculum(yearId),
        qk.feasibility(yearId),
        qk.versions(yearId),
        qk.requirements(yearId),
        qk.grades(yearId),
        ...(options.subjects ? [qk.subjects(), qk.teachers()] : []),
      ];
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    [queryClient, yearId],
  );
}
