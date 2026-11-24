"use client";

import { useQuery } from "@tanstack/react-query";
import { feasibilityApi, generationApi, versionsApi } from "@/lib/api/endpoints";
import type { GenerationRun } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import { isActiveStatus } from "./rules";

export const RUN_POLL_MS = 2_500;

export function useFeasibility(yearId: string) {
  return useQuery({ queryKey: qk.feasibility(yearId), queryFn: () => feasibilityApi.get(yearId), staleTime: 15_000 });
}

export function useRuns(yearId: string, active: boolean) {
  return useQuery({
    queryKey: qk.runs(yearId),
    queryFn: () => generationApi.list(yearId, 10),
    // While a run is in progress the list is refreshed slowly so its status column follows along.
    refetchInterval: active ? 10_000 : false,
  });
}

/** Polls one run every 2.5 s while it is QUEUED or RUNNING. TanStack pauses polling while the tab is hidden. */
export function useRun(runId: string | null) {
  return useQuery({
    queryKey: qk.run(runId ?? "none"),
    queryFn: () => generationApi.get(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const run = query.state.data as GenerationRun | undefined;
      return !run || isActiveStatus(run.status) ? RUN_POLL_MS : false;
    },
    refetchIntervalInBackground: false,
    retry: (count, error) => !(error as { isNotFound?: boolean }).isNotFound && count < 2,
  });
}

export function useYearVersions(yearId: string) {
  return useQuery({ queryKey: qk.versionsWithStaleness(yearId), queryFn: () => versionsApi.list(yearId, { includeStaleness: true }) });
}
