"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Detail pages register a human label for their own path (e.g. a teacher's name for /years/…/teachers/<id>)
 * so the header breadcrumb never shows a raw id.
 */
let labels: Record<string, string> = {};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function useBreadcrumbOverrides(): Record<string, string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => labels,
    () => labels,
  );
}

/** Call from a page: `useBreadcrumb(pathname, teacher?.name)`. */
export function useBreadcrumb(href: string, label: string | undefined | null) {
  useEffect(() => {
    if (!label) return;
    labels = { ...labels, [href]: label };
    emit();
    return () => {
      const next = { ...labels };
      delete next[href];
      labels = next;
      emit();
    };
  }, [href, label]);
}
