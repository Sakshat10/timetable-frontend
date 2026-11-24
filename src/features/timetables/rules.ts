/**
 * Pure rules for the versions list, the viewer and the editor (PHASE-0-AUDIT.md §5; CAPABILITY-BOUNDARIES X3–X8, P5–P7).
 * No React, no network: unit-tested in rules.test.ts.
 */
import type { DayOfWeek, TimetableView, Validation, VersionDetail, VersionEntry, VersionSummary } from "@/lib/api/types";

export interface Slot {
  dayOfWeek: DayOfWeek;
  periodNumber: number;
}

export const sameSlot = (a: Slot, b: Slot) => a.dayOfWeek === b.dayOfWeek && a.periodNumber === b.periodNumber;
export const slotKey = (slot: Slot) => `${slot.dayOfWeek}|${slot.periodNumber}`;

// ------------------------------------------------------------------ grid (§5.1)

/**
 * The break sits after the period whose `continuesIntoNext === false` and that is not the last period.
 * Returns the period numbers after which a break separator is drawn (in grid order).
 */
export function breakAfterPeriods(periods: readonly Pick<TimetableView["grid"]["periods"][number], "periodNumber" | "continuesIntoNext">[]): number[] {
  const ordered = [...periods].sort((a, b) => a.periodNumber - b.periodNumber);
  return ordered.filter((p, i) => !p.continuesIntoNext && i < ordered.length - 1).map((p) => p.periodNumber);
}

export type Lesson = NonNullable<TimetableView["cells"][number]["lesson"]>;

/** Index the view's cells by slot. */
export function cellMap(view: Pick<TimetableView, "cells">): Map<string, Lesson | null> {
  const map = new Map<string, Lesson | null>();
  for (const cell of view.cells) map.set(slotKey(cell), cell.lesson);
  return map;
}

// ------------------------------------------------------------------ move vs swap (§5.2)

export type DropDecision =
  | { kind: "none" }
  | { kind: "MOVE"; entryId: string; from: Slot; to: Slot }
  | { kind: "SWAP"; entryId: string; from: Slot; to: Slot; swapWithEntryId: string };

/**
 * A lesson dropped on a cell of the SAME section grid (X7: no other drop targets exist).
 * Empty cell → MOVE. Occupied cell → SWAP, and `to` is the partner's slot. Its own cell → nothing.
 */
export function decideDrop(source: { entryId: string; slot: Slot }, target: { slot: Slot; occupantEntryId: string | null }): DropDecision {
  if (sameSlot(source.slot, target.slot)) return { kind: "none" };
  if (target.occupantEntryId === source.entryId) return { kind: "none" };
  if (target.occupantEntryId) {
    return { kind: "SWAP", entryId: source.entryId, from: source.slot, to: target.slot, swapWithEntryId: target.occupantEntryId };
  }
  return { kind: "MOVE", entryId: source.entryId, from: source.slot, to: target.slot };
}

export type DropHint = "move" | "swap" | "locked" | "teacher-busy";

/**
 * ADVISORY hints computed from the loaded version entries (the server stays authoritative, §5.8).
 * "teacher-busy": the moving teacher already teaches another section in the target slot (or, for a swap, the
 * partner's teacher does in the source slot).
 */
export function dropHints(decision: DropDecision, entries: readonly Pick<VersionEntry, "id" | "teacherId" | "dayOfWeek" | "periodNumber" | "isLocked">[]): DropHint[] {
  if (decision.kind === "none") return [];
  const byId = new Map(entries.map((e) => [e.id, e]));
  const source = byId.get(decision.entryId);
  const hints: DropHint[] = [decision.kind === "SWAP" ? "swap" : "move"];
  const partner = decision.kind === "SWAP" ? byId.get(decision.swapWithEntryId) : undefined;
  if (source?.isLocked || partner?.isLocked) hints.push("locked");
  const ignore = new Set([decision.entryId, ...(decision.kind === "SWAP" ? [decision.swapWithEntryId] : [])]);
  const busy = (teacherId: string | undefined, slot: Slot) =>
    teacherId !== undefined && entries.some((e) => !ignore.has(e.id) && e.teacherId === teacherId && e.dayOfWeek === slot.dayOfWeek && e.periodNumber === slot.periodNumber);
  if (busy(source?.teacherId, decision.to) || (partner && busy(partner.teacherId, decision.from))) hints.push("teacher-busy");
  return hints;
}

// ------------------------------------------------------------------ undo / redo (§5.8)

export type EditAction =
  | { kind: "MOVE"; entryId: string; from: Slot; to: Slot }
  | { kind: "SWAP"; entryId: string; swapWithEntryId: string; from: Slot; to: Slot }
  | { kind: "LOCK"; entryIds: string[]; locked: boolean };

export type EditRequest =
  | { kind: "move"; body: { entryId: string; to: Slot; swapWithEntryId?: string } }
  | { kind: "locks"; body: { entryIds: string[]; locked: boolean } };

/** The request that performs an action (used for the original action and for redo). */
export function requestFor(action: EditAction): EditRequest {
  switch (action.kind) {
    case "MOVE":
      return { kind: "move", body: { entryId: action.entryId, to: action.to } };
    case "SWAP":
      return { kind: "move", body: { entryId: action.entryId, to: action.to, swapWithEntryId: action.swapWithEntryId } };
    case "LOCK":
      return { kind: "locks", body: { entryIds: action.entryIds, locked: action.locked } };
  }
}

/**
 * The request that undoes an action. Undo of a MOVE is a move back; undo of a SWAP is the same swap again
 * (the entry, now in the partner's old slot, swaps back into its own old slot); undo of a lock is the opposite
 * lock on the recorded ids. Each undo is a NEW server request and can be refused.
 */
export function inverseRequest(action: EditAction): EditRequest {
  switch (action.kind) {
    case "MOVE":
      return { kind: "move", body: { entryId: action.entryId, to: action.from } };
    case "SWAP":
      return { kind: "move", body: { entryId: action.entryId, to: action.from, swapWithEntryId: action.swapWithEntryId } };
    case "LOCK":
      return { kind: "locks", body: { entryIds: action.entryIds, locked: !action.locked } };
  }
}

/** Short description for undo/redo buttons and notices. */
export function describeAction(action: EditAction): string {
  switch (action.kind) {
    case "MOVE":
      return "move";
    case "SWAP":
      return "swap";
    case "LOCK":
      return `${action.locked ? "lock" : "unlock"} of ${action.entryIds.length} lesson${action.entryIds.length === 1 ? "" : "s"}`;
  }
}

export interface UndoState {
  undo: EditAction[];
  redo: EditAction[];
}

export const EMPTY_UNDO: UndoState = { undo: [], redo: [] };

/** A new confirmed action clears the redo stack. */
export function pushAction(state: UndoState, action: EditAction, limit = 50): UndoState {
  return { undo: [...state.undo, action].slice(-limit), redo: [] };
}

/** After an undo was CONFIRMED by the server. */
export function afterUndo(state: UndoState): UndoState {
  const action = state.undo.at(-1);
  if (!action) return state;
  return { undo: state.undo.slice(0, -1), redo: [...state.redo, action] };
}

/** After a redo was CONFIRMED by the server. */
export function afterRedo(state: UndoState): UndoState {
  const action = state.redo.at(-1);
  if (!action) return state;
  return { undo: [...state.undo, action], redo: state.redo.slice(0, -1) };
}

/** Lock ids that would actually change (the server does not say which ids changed, §5.3). */
export function idsToChange(entries: readonly Pick<VersionEntry, "id" | "isLocked">[], ids: readonly string[], locked: boolean): string[] {
  const wanted = new Set(ids);
  return entries.filter((e) => wanted.has(e.id) && e.isLocked !== locked).map((e) => e.id);
}

/** Apply `changedEntries` from a move response to the version's entry list (authoritative, §5.8). */
export function applyChangedEntries<E extends { id: string }>(entries: readonly E[], changed: readonly E[]): E[] {
  const byId = new Map(changed.map((e) => [e.id, e]));
  return entries.map((e) => byId.get(e.id) ?? e);
}

// ------------------------------------------------------------------ editing gate (M11)

export type EditGate = { editable: true } | { editable: false; reason: string };

export function editGate(args: { versionStatus: VersionDetail["status"]; canEditVersions: boolean; wideEnough: boolean; yearName: string }): EditGate {
  if (args.versionStatus !== "DRAFT") return { editable: false, reason: "Only draft versions can be edited. Copy this version to a new draft to make changes." };
  if (!args.canEditVersions) return { editable: false, reason: `${args.yearName} is completed, so its timetables are read-only.` };
  if (!args.wideEnough) return { editable: false, reason: "Editing needs a wider screen (at least 1024 pixels). You can still view the timetable here." };
  return { editable: true };
}

// ------------------------------------------------------------------ publish gate (§5.4, §5.5)

export type PublishGate = { allowed: true } | { allowed: false; reason: string; kind: "not-draft" | "year" | "stale" | "invalid" | "checking" | "unknown-published" };

export function publishGate(args: {
  version: Pick<VersionDetail, "status" | "revision">;
  validation: Pick<Validation, "revision" | "valid" | "isStale" | "violationCount" | "informational"> | undefined;
  canPublish: boolean;
  publishedKnown: boolean;
}): PublishGate {
  const { version, validation, canPublish, publishedKnown } = args;
  if (version.status !== "DRAFT") return { allowed: false, kind: "not-draft", reason: "Only a draft can be published." };
  if (!canPublish) return { allowed: false, kind: "year", reason: "This academic year is completed, so nothing can be published." };
  if (!validation || validation.revision !== version.revision) return { allowed: false, kind: "checking", reason: "Checking the latest changes…" };
  if (validation.isStale) {
    return { allowed: false, kind: "stale", reason: "The setup has changed since this draft was generated, so it can’t be published. Generate a new draft." };
  }
  if (!validation.valid) {
    return { allowed: false, kind: "invalid", reason: `This draft breaks ${validation.violationCount} scheduling rule${validation.violationCount === 1 ? "" : "s"}. Fix them before publishing.` };
  }
  if (!validation.informational.publishable) return { allowed: false, kind: "year", reason: "The server reports that this draft can’t be published right now." };
  if (!publishedKnown) return { allowed: false, kind: "unknown-published", reason: "Loading the currently published version…" };
  return { allowed: true };
}

// ------------------------------------------------------------------ versions list (§1.13)

export type StaleState = "stale" | "current" | "unknown" | "not-applicable";

/** Drafts only: `isStale` null (or missing) means the server could not establish it. */
export function staleState(version: Pick<VersionSummary, "status" | "isStale">): StaleState {
  if (version.status !== "DRAFT") return "not-applicable";
  if (version.isStale === true) return "stale";
  if (version.isStale === false) return "current";
  return "unknown";
}

export function publishedVersion<V extends Pick<VersionSummary, "status">>(versions: readonly V[] | undefined): V | null {
  return versions?.find((v) => v.status === "PUBLISHED") ?? null;
}

/** Which delete a version offers (P6: never the PUBLISHED one). */
export function deleteKind(status: VersionSummary["status"]): "draft" | "archived" | null {
  if (status === "DRAFT") return "draft";
  if (status === "ARCHIVED") return "archived";
  return null;
}

// ------------------------------------------------------------------ refusals (§5.2)

export interface Refusal {
  title: string;
  description: string;
}

/** User-facing text for a move/lock refusal code. */
export function refusalText(code: string | null, message: string): Refusal {
  switch (code) {
    case "SLOT_OCCUPIED":
      return { title: "That slot is already taken", description: "Another lesson of this class is in that slot now. You can swap the two lessons instead." };
    case "ENTRY_LOCKED":
      return { title: "A locked lesson can’t be moved", description: "Unlock the lesson (and the one it would swap with) first." };
    case "TEACHER_BUSY":
      return { title: "The teacher is busy then", description: "The teacher already teaches another class in that slot, so the change was refused." };
    case "INVALID_SLOT":
      return { title: "That slot isn’t part of this timetable", description: "Choose a working day and period of the timetable’s grid." };
    case "INVALID_MOVE":
      return { title: "That move isn’t possible", description: "A lesson can only move to an empty slot of its own class." };
    case "INVALID_SWAP":
      return { title: "That swap isn’t possible", description: "Only two lessons of the same class can swap slots." };
    case "INVARIANT_VIOLATION":
      return { title: "The change would break a scheduling rule", description: "The server refused it. Nothing was changed." };
    case "REVISION_CONFLICT":
      return { title: "Someone else changed this timetable", description: "It has been reloaded with their changes. Your undo history was cleared. Review the timetable and try again." };
    case "VERSION_NOT_DRAFT":
      return { title: "This version is no longer a draft", description: "It may have been published meanwhile. It has been reloaded." };
    case "ACADEMIC_YEAR_NOT_EDITABLE":
      return { title: "This academic year can’t be edited", description: "The year is completed, so its timetables are read-only." };
    case "SNAPSHOT_UNUSABLE":
      return { title: "This draft can’t be edited", description: "The setup snapshot stored with it can’t be read. Generate a new draft instead." };
    case "ENTRY_NOT_FOUND":
      return { title: "That lesson no longer exists", description: "The timetable has been reloaded." };
    case "BUSY":
      return { title: "The server is busy", description: "Another change to this year is in progress. Try again in a moment." };
    default:
      return { title: "The change was not saved", description: message };
  }
}
