"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { curriculumApi, teachersApi, versionsApi } from "@/lib/api/endpoints";
import { qk } from "@/lib/query/keys";

export function useVersions(yearId: string) {
  return useQuery({ queryKey: qk.versionsWithStaleness(yearId), queryFn: () => versionsApi.list(yearId, { includeStaleness: true }) });
}

/** The version detail. Polled every 20 s while editing to detect changes made elsewhere (§5.8). */
export function useVersion(versionId: string, pollWhileEditing: boolean) {
  return useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => versionsApi.get(versionId),
    refetchInterval: pollWhileEditing ? 20_000 : false,
    refetchIntervalInBackground: false,
    retry: (count, error) => !(error as { isNotFound?: boolean }).isNotFound && count < 2,
  });
}

export function useValidation(versionId: string, enabled: boolean) {
  return useQuery({ queryKey: qk.validation(versionId), queryFn: () => versionsApi.validation(versionId), enabled, retry: 1 });
}

export function useView(versionId: string, view: "section" | "teacher", entityId: string | null) {
  return useQuery({
    queryKey: qk.view(versionId, view, entityId ?? "none"),
    queryFn: () => versionsApi.view(versionId, view, entityId as string),
    enabled: Boolean(entityId),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === view ? previous : undefined),
    retry: (count, error) => !(error as { isNotFound?: boolean }).isNotFound && count < 2,
  });
}

export function useCurriculum(yearId: string) {
  return useQuery({ queryKey: qk.curriculum(yearId), queryFn: () => curriculumApi.overview(yearId) });
}

export function useTeachers() {
  return useQuery({ queryKey: qk.teachers(), queryFn: () => teachersApi.list() });
}

const WIDE = "(min-width: 1024px)";

/** True at ≥1024 px (editing threshold, M11). False during server rendering. */
export function useIsWide() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(WIDE);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** True below 768 px (day-by-day list layout). */
export function useIsNarrow() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia("(max-width: 767px)");
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );
}
