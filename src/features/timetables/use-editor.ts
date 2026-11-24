"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { versionsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { MoveResult, VersionDetail } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import {
  afterRedo,
  afterUndo,
  applyChangedEntries,
  describeAction,
  EMPTY_UNDO,
  inverseRequest,
  pushAction,
  refusalText,
  requestFor,
  type EditAction,
  type EditRequest,
  type UndoState,
} from "./rules";

export interface EditorNotice {
  tone: "error" | "info" | "success";
  title: string;
  description?: string;
  items?: string[];
  action?: { label: string; run: () => void };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pessimistic editing of one draft version (§5.2, §5.3, §5.8):
 * - every change is its own server request with the current `expectedRevision`; nothing is shown as saved before the server confirms;
 * - `changedEntries` from a move are applied to the cached version, then the visible view and the validation are refetched;
 * - undo/redo is a client stack; each step is a new request that can be refused; the stack is cleared on any conflict
 *   or when the revision changes elsewhere (detected by polling GET version).
 */
export function useTimetableEditor({ versionId, yearId, revision }: { versionId: string; yearId: string; revision: number | undefined }) {
  const queryClient = useQueryClient();
  const [stack, setStack] = useState<UndoState>(EMPTY_UNDO);
  const [pending, setPending] = useState<{ entryIds: string[] } | null>(null);
  const [notice, setNotice] = useState<EditorNotice | null>(null);
  const knownRevision = useRef<number | null>(null);
  const busy = useRef(false);

  // The stack is per version: the page mounts the editor with key={versionId}, so a new version starts empty.

  // External change detection: a revision we did not produce.
  useEffect(() => {
    if (revision === undefined) return;
    if (knownRevision.current === null) {
      knownRevision.current = revision;
      return;
    }
    if (busy.current || revision === knownRevision.current) return;
    knownRevision.current = revision;
    setStack(EMPTY_UNDO);
    setNotice({
      tone: "info",
      title: "This timetable was changed elsewhere",
      description: "The latest version has been loaded. Your undo history was cleared.",
    });
    void queryClient.invalidateQueries({ queryKey: [...qk.version(versionId), "view"] });
    void queryClient.invalidateQueries({ queryKey: qk.validation(versionId) });
  }, [revision, versionId, queryClient]);

  const reloadAll = useCallback(async () => {
    knownRevision.current = null;
    setStack(EMPTY_UNDO);
    await queryClient.invalidateQueries({ queryKey: qk.version(versionId) });
    knownRevision.current = queryClient.getQueryData<VersionDetail>(qk.version(versionId))?.revision ?? null;
    void queryClient.invalidateQueries({ queryKey: qk.versions(yearId) });
  }, [queryClient, versionId, yearId]);

  const send = useCallback(
    async (request: EditRequest, onSlotOccupied?: (occupantEntryId: string) => void): Promise<boolean> => {
      const current = queryClient.getQueryData<VersionDetail>(qk.version(versionId));
      if (!current || busy.current) return false;
      busy.current = true;
      setNotice(null);
      setPending({ entryIds: request.kind === "move" ? [request.body.entryId, ...(request.body.swapWithEntryId ? [request.body.swapWithEntryId] : [])] : request.body.entryIds });
      try {
        let attempt = 0;
        for (;;) {
          try {
            if (request.kind === "move") {
              const { data } = await versionsApi.move(versionId, { ...request.body, expectedRevision: current.revision });
              applyMove(data);
            } else {
              const { data } = await versionsApi.setLocks(versionId, { ...request.body, expectedRevision: current.revision });
              knownRevision.current = data.revision;
              const ids = new Set(request.body.entryIds);
              queryClient.setQueryData<VersionDetail>(qk.version(versionId), (old) =>
                old
                  ? {
                      ...old,
                      revision: data.revision,
                      lockedCount: data.lockedCount,
                      entries: old.entries.map((e) => (ids.has(e.id) ? { ...e, isLocked: request.body.locked } : e)),
                    }
                  : old,
              );
            }
            break;
          } catch (error) {
            // 503 BUSY: nothing was applied; the same request may be repeated after Retry-After, at most 3 times.
            if (isApiError(error) && error.status === 503 && attempt < 3) {
              attempt += 1;
              await sleep(error.retryAfterMs ?? 2_000);
              continue;
            }
            throw error;
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [...qk.version(versionId), "view"] }),
          queryClient.invalidateQueries({ queryKey: qk.validation(versionId) }),
          queryClient.invalidateQueries({ queryKey: qk.versions(yearId) }),
        ]);
        return true;
      } catch (error) {
        await handleError(error, onSlotOccupied);
        return false;
      } finally {
        busy.current = false;
        setPending(null);
      }

      function applyMove(data: MoveResult) {
        knownRevision.current = data.revision;
        queryClient.setQueryData<VersionDetail>(qk.version(versionId), (old) =>
          old
            ? {
                ...old,
                revision: data.revision,
                manualEditCount: data.manualEditCount,
                lockedCount: data.lockedCount,
                entries: applyChangedEntries(old.entries, data.changedEntries),
              }
            : old,
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, versionId, yearId],
  );

  async function handleError(error: unknown, onSlotOccupied?: (occupantEntryId: string) => void) {
    if (!isApiError(error)) {
      setNotice({ tone: "error", title: "The change was not saved", description: "Something went wrong. Please try again." });
      return;
    }
    if (error.uncertain) {
      await reloadAll();
      setNotice({
        tone: "error",
        title: "We couldn’t confirm whether the change was saved",
        description: "The server’s answer was lost. The timetable has been reloaded to show its current state, and your undo history was cleared.",
      });
      return;
    }
    const text = refusalText(error.code, error.message);
    switch (error.code) {
      case "REVISION_CONFLICT":
      case "VERSION_NOT_DRAFT":
      case "ENTRY_NOT_FOUND":
      case "SNAPSHOT_UNUSABLE":
      case "ACADEMIC_YEAR_NOT_EDITABLE":
        await reloadAll();
        setNotice({ tone: "error", ...text });
        return;
      case "SLOT_OCCUPIED": {
        void queryClient.invalidateQueries({ queryKey: [...qk.version(versionId), "view"] });
        const occupant = typeof error.details.occupantEntryId === "string" ? error.details.occupantEntryId : null;
        setNotice({
          tone: "error",
          ...text,
          action: occupant && onSlotOccupied ? { label: "Swap instead", run: () => onSlotOccupied(occupant) } : undefined,
        });
        return;
      }
      case "INVARIANT_VIOLATION": {
        const violations = Array.isArray(error.details.violations) ? (error.details.violations as Array<{ message?: string; code?: string }>) : [];
        setNotice({ tone: "error", ...text, items: violations.map((v) => v.message ?? v.code ?? "Rule violation") });
        return;
      }
      default:
        setNotice({ tone: "error", ...text });
    }
  }

  const perform = useCallback(
    async (action: EditAction): Promise<boolean> => {
      const ok = await send(requestFor(action), (occupant) => {
        if (action.kind !== "MOVE") return;
        void perform({ kind: "SWAP", entryId: action.entryId, swapWithEntryId: occupant, from: action.from, to: action.to });
      });
      if (ok) setStack((s) => pushAction(s, action));
      return ok;
    },
    [send],
  );

  const undo = useCallback(async () => {
    const action = stack.undo.at(-1);
    if (!action) return;
    const ok = await send(inverseRequest(action));
    if (ok) {
      setStack(afterUndo);
      setNotice({ tone: "success", title: `Undid the ${describeAction(action)}` });
    }
  }, [send, stack]);

  const redo = useCallback(async () => {
    const action = stack.redo.at(-1);
    if (!action) return;
    const ok = await send(requestFor(action));
    if (ok) {
      setStack(afterRedo);
      setNotice({ tone: "success", title: `Redid the ${describeAction(action)}` });
    }
  }, [send, stack]);

  return {
    perform,
    undo,
    redo,
    canUndo: stack.undo.length > 0 && !pending,
    canRedo: stack.redo.length > 0 && !pending,
    nextUndo: stack.undo.at(-1) ?? null,
    nextRedo: stack.redo.at(-1) ?? null,
    pending,
    notice,
    dismissNotice: () => setNotice(null),
  };
}
