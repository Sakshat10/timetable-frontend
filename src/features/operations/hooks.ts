"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { absencesApi, coversApi, gradesApi, substitutionSettingsApi, teachersApi, unavailabilityApi, versionsApi, yearsApi } from "@/lib/api/endpoints";
import type { Cover } from "@/lib/api/schemas";
import type { AssignCoverBody, AutoAssignRangeBody, CreateAbsenceBody, CreateUnavailabilityBody, UpdateAbsenceBody } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import { ALL_STATUSES, OPEN_STATUSES, yearsContaining } from "./board-rules";

/** First segments of every daily-operations query key (qk.covers/cover/candidates/absences/absence/unavailability). */
const OPERATION_KEYS = new Set(["covers", "cover", "absences", "absence", "unavailability"]);

/** Re-reads every daily-operations query: after any write, and after an uncertain outcome. */
export function invalidateOperations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => OPERATION_KEYS.has(String(query.queryKey[0])) });
}

const PAGE = 500;

/**
 * The covers of one day. GET /substitutions runs the backend's sync (it can write), so this is never polled:
 * it refetches on focus, after writes, and when the "Substitution updates" bell sees new events.
 */
export function useDayCovers(date: string, includeClosed: boolean) {
  return useQuery({
    queryKey: qk.covers({ from: date, to: date, includeClosed }),
    queryFn: async () => {
      const status = [...(includeClosed ? ALL_STATUSES : OPEN_STATUSES)];
      const items: Cover[] = [];
      let total = 0;
      for (let offset = 0; offset < 10 * PAGE; offset += PAGE) {
        const page = await coversApi.list({ from: date, to: date, status, limit: PAGE, offset });
        total = page.total;
        items.push(...page.items);
        if (items.length >= total || page.items.length === 0) break;
      }
      return { total, items };
    },
  });
}

export function useCover(id: string | null) {
  return useQuery({ queryKey: qk.cover(id ?? ""), queryFn: () => coversApi.get(id!), enabled: Boolean(id) });
}

export function useCandidates(id: string | null, enabled: boolean) {
  return useQuery({ queryKey: qk.candidates(id ?? ""), queryFn: () => coversApi.candidates(id!), enabled: Boolean(id) && enabled, staleTime: 0 });
}

export function useSubstitutionSettings() {
  return useQuery({ queryKey: qk.substitutionSettings(), queryFn: substitutionSettingsApi.get, staleTime: 5 * 60_000 });
}

export function useTeachers() {
  return useQuery({ queryKey: qk.teachers(), queryFn: () => teachersApi.list() });
}

export function useYears() {
  return useQuery({ queryKey: qk.years(), queryFn: yearsApi.list });
}

/** Grade names for the academic year containing a date (to label sections "Grade 8 · Section B"). Optional decoration. */
export function useGradeNames(date: string) {
  const years = useYears();
  const matches = years.data ? yearsContaining(years.data, date) : [];
  const yearId = matches.length === 1 ? matches[0]!.id : null;
  const grades = useQuery({ queryKey: qk.grades(yearId ?? ""), queryFn: () => gradesApi.list(yearId!), enabled: Boolean(yearId) });
  const map = new Map<string, string>();
  for (const grade of grades.data ?? []) map.set(grade.id, grade.name);
  return map;
}

/** All versions of a year (filtered by the caller); shares the cache with the timetable screens. */
export function useYearVersions(yearId: string | null) {
  return useQuery({ queryKey: qk.versions(yearId ?? ""), queryFn: () => versionsApi.list(yearId!), enabled: Boolean(yearId) });
}

export function useTeacherView(versionId: string | null, teacherId: string | null) {
  return useQuery({
    queryKey: qk.view(versionId ?? "", "teacher", teacherId ?? ""),
    queryFn: () => versionsApi.view(versionId!, "teacher", teacherId!),
    enabled: Boolean(versionId && teacherId),
  });
}

export interface AbsenceFilters {
  status?: "ACTIVE" | "CANCELLED";
  teacherId?: string;
  from?: string;
  to?: string;
}

export function useAbsences(filters: AbsenceFilters) {
  return useQuery({ queryKey: qk.absences({ ...filters }), queryFn: () => absencesApi.list(filters) });
}

export function useAbsence(id: string) {
  return useQuery({ queryKey: qk.absence(id), queryFn: () => absencesApi.get(id) });
}

export function useAbsenceSummary(id: string) {
  return useQuery({ queryKey: qk.absenceSummary(id), queryFn: () => absencesApi.summary(id) });
}

export interface UnavailabilityFilters {
  status?: "ACTIVE" | "CANCELLED";
  teacherId?: string;
  from?: string;
  to?: string;
}

export function useUnavailability(filters: UnavailabilityFilters) {
  return useQuery({ queryKey: qk.unavailability({ ...filters }), queryFn: () => unavailabilityApi.list(filters) });
}

// ------------------------------------------------------------------ writes (pessimistic: re-read after the answer)

function useOperationMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Success and failure both re-read: a refusal can mean the board changed, and an uncertain outcome must never be re-sent.
    onSettled: () => invalidateOperations(queryClient),
  });
}

export function useAssignCover() {
  return useOperationMutation(({ id, body }: { id: string; body: AssignCoverBody }) => coversApi.assign(id, body));
}

export function useUnassignCover() {
  return useOperationMutation((id: string) => coversApi.unassign(id));
}

export function useCancelCover() {
  return useOperationMutation(({ id, reason }: { id: string; reason?: string }) => coversApi.cancel(id, reason));
}

export function useAutoAssignRange() {
  return useOperationMutation((body: AutoAssignRangeBody) => coversApi.autoAssignRange(body));
}

export function useCreateAbsence() {
  return useOperationMutation((body: CreateAbsenceBody) => absencesApi.create(body));
}

export function useUpdateAbsence() {
  return useOperationMutation(({ id, body }: { id: string; body: UpdateAbsenceBody }) => absencesApi.update(id, body));
}

export function useCancelAbsence() {
  return useOperationMutation((id: string) => absencesApi.cancel(id));
}

export function useAbsenceAutoAssign() {
  return useOperationMutation(({ id, allowTemporaryCover }: { id: string; allowTemporaryCover?: boolean }) => absencesApi.autoAssign(id, allowTemporaryCover));
}

export function useCreateUnavailability() {
  return useOperationMutation((body: CreateUnavailabilityBody) => unavailabilityApi.create(body));
}

export function useCancelUnavailability() {
  return useOperationMutation((id: string) => unavailabilityApi.cancel(id));
}
