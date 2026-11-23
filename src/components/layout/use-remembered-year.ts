"use client";

import { useSyncExternalStore } from "react";
import { YEAR_PREFERENCE_COOKIE } from "@/features/academic-years/year-context";

function read(): string | null {
  try {
    const match = document.cookie.split("; ").find((part) => part.startsWith(`${YEAR_PREFERENCE_COOKIE}=`));
    return match ? decodeURIComponent(match.slice(YEAR_PREFERENCE_COOKIE.length + 1)) : null;
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/** The last academic year the user opened (preference cookie), for links on pages outside a year. */
export function useRememberedYearId(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
