"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { yearsApi } from "@/lib/api/endpoints";
import type { AcademicYear } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import { YEAR_PREFERENCE_COOKIE } from "./year-defaults";

export { pickDefaultYear, YEAR_PREFERENCE_COOKIE } from "./year-defaults";


export interface YearCapabilities {
  /** Structure, curriculum, grade eligibility, assignments and schedule writes (backend: DRAFT only). */
  canEditSetup: boolean;
  /** Queue a generation run (backend: DRAFT only). */
  canGenerate: boolean;
  /** Move/swap/lock lessons of draft versions, clone, delete drafts (backend: DRAFT or ACTIVE year). */
  canEditVersions: boolean;
  /** Publish a draft (backend: DRAFT or ACTIVE year). */
  canPublish: boolean;
  /** Explains why setup is locked, if it is. */
  setupLockedReason: string | null;
}

export function capabilitiesFor(year: Pick<AcademicYear, "status" | "name">): YearCapabilities {
  const draft = year.status === "DRAFT";
  const completed = year.status === "COMPLETED";
  return {
    canEditSetup: draft,
    canGenerate: draft,
    canEditVersions: !completed,
    canPublish: !completed,
    setupLockedReason: draft
      ? null
      : completed
        ? `${year.name} is completed. Its setup and timetables are read-only.`
        : `${year.name} is active. Setup is locked once a year is activated; timetable drafts can still be edited and published.`,
  };
}

interface YearContextValue {
  year: AcademicYear;
  capabilities: YearCapabilities;
  /** Base path for year-scoped pages, e.g. /years/<id> */
  basePath: string;
}

const YearContext = createContext<YearContextValue | null>(null);

/**
 * The selected academic year. It lives in the URL (/years/[yearId]/…), so it survives refresh, navigation
 * and deep links. A non-sensitive preference cookie remembers the last year for the "/" redirect.
 */
export function YearProvider({ initialYear, children }: { initialYear: AcademicYear; children: ReactNode }) {
  const { data: year = initialYear } = useQuery({
    queryKey: qk.year(initialYear.id),
    queryFn: () => yearsApi.get(initialYear.id),
    initialData: initialYear,
    staleTime: 60_000,
  });

  useEffect(() => {
    try {
      document.cookie = `${YEAR_PREFERENCE_COOKIE}=${encodeURIComponent(year.id)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    } catch {
      /* preference only */
    }
  }, [year.id]);

  return <YearContext value={{ year, capabilities: capabilitiesFor(year), basePath: `/years/${year.id}` }}>{children}</YearContext>;
}

export function useYear(): YearContextValue {
  const value = useContext(YearContext);
  if (!value) throw new Error("useYear must be used inside /years/[yearId]");
  return value;
}

/** For components rendered both inside and outside a year (e.g. the sidebar). */
export function useOptionalYear(): YearContextValue | null {
  return useContext(YearContext);
}
