import { describe, expect, it } from "vitest";
import {
  afterRedo,
  afterUndo,
  applyChangedEntries,
  breakAfterPeriods,
  decideDrop,
  deleteKind,
  dropHints,
  EMPTY_UNDO,
  editGate,
  idsToChange,
  inverseRequest,
  publishGate,
  pushAction,
  requestFor,
  staleState,
  type EditAction,
} from "./rules";

const MON1 = { dayOfWeek: "MONDAY" as const, periodNumber: 1 };
const MON2 = { dayOfWeek: "MONDAY" as const, periodNumber: 2 };
const TUE3 = { dayOfWeek: "TUESDAY" as const, periodNumber: 3 };

describe("break position", () => {
  const p = (periodNumber: number, continuesIntoNext: boolean) => ({ periodNumber, continuesIntoNext });
  it("places the break after the period that does not continue, unless it is the last", () => {
    expect(breakAfterPeriods([p(1, true), p(2, true), p(3, false), p(4, true), p(5, true), p(6, false)])).toEqual([3]);
  });
  it("draws no break when only the last period does not continue", () => {
    expect(breakAfterPeriods([p(1, true), p(2, true), p(3, false)])).toEqual([]);
  });
  it("is independent of the input order", () => {
    expect(breakAfterPeriods([p(4, false), p(2, false), p(1, true), p(3, true)])).toEqual([2]);
  });
});

describe("move vs swap", () => {
  it("is a MOVE onto an empty cell", () => {
    expect(decideDrop({ entryId: "a", slot: MON1 }, { slot: TUE3, occupantEntryId: null })).toEqual({ kind: "MOVE", entryId: "a", from: MON1, to: TUE3 });
  });
  it("is a SWAP onto an occupied cell, with `to` equal to the partner's slot", () => {
    expect(decideDrop({ entryId: "a", slot: MON1 }, { slot: MON2, occupantEntryId: "b" })).toEqual({ kind: "SWAP", entryId: "a", from: MON1, to: MON2, swapWithEntryId: "b" });
  });
  it("does nothing on its own cell", () => {
    expect(decideDrop({ entryId: "a", slot: MON1 }, { slot: MON1, occupantEntryId: "a" })).toEqual({ kind: "none" });
  });

  it("computes advisory hints from the loaded entries", () => {
    const entries = [
      { id: "a", teacherId: "t1", dayOfWeek: "MONDAY" as const, periodNumber: 1, isLocked: false },
      { id: "b", teacherId: "t2", dayOfWeek: "MONDAY" as const, periodNumber: 2, isLocked: true },
      { id: "other", teacherId: "t1", dayOfWeek: "TUESDAY" as const, periodNumber: 3, isLocked: false },
    ];
    expect(dropHints(decideDrop({ entryId: "a", slot: MON1 }, { slot: TUE3, occupantEntryId: null }), entries)).toEqual(["move", "teacher-busy"]);
    expect(dropHints(decideDrop({ entryId: "a", slot: MON1 }, { slot: MON2, occupantEntryId: "b" }), entries)).toEqual(["swap", "locked"]);
  });
});

describe("undo inversion", () => {
  it("undoes a MOVE by moving back", () => {
    const action: EditAction = { kind: "MOVE", entryId: "a", from: MON1, to: TUE3 };
    expect(requestFor(action)).toEqual({ kind: "move", body: { entryId: "a", to: TUE3 } });
    expect(inverseRequest(action)).toEqual({ kind: "move", body: { entryId: "a", to: MON1 } });
  });
  it("undoes a SWAP with the same swap again", () => {
    const action: EditAction = { kind: "SWAP", entryId: "a", swapWithEntryId: "b", from: MON1, to: MON2 };
    expect(requestFor(action)).toEqual({ kind: "move", body: { entryId: "a", to: MON2, swapWithEntryId: "b" } });
    // After the swap, b sits in MON1: swapping a with b again targets b's current slot (a's old slot).
    expect(inverseRequest(action)).toEqual({ kind: "move", body: { entryId: "a", to: MON1, swapWithEntryId: "b" } });
  });
  it("undoes a lock with the opposite lock on the recorded ids", () => {
    const action: EditAction = { kind: "LOCK", entryIds: ["a", "b"], locked: true };
    expect(inverseRequest(action)).toEqual({ kind: "locks", body: { entryIds: ["a", "b"], locked: false } });
  });
  it("moves actions between the stacks only after confirmation, and a new action clears redo", () => {
    const a: EditAction = { kind: "LOCK", entryIds: ["x"], locked: true };
    const b: EditAction = { kind: "MOVE", entryId: "a", from: MON1, to: TUE3 };
    let state = pushAction(pushAction(EMPTY_UNDO, a), b);
    state = afterUndo(state);
    expect(state).toEqual({ undo: [a], redo: [b] });
    expect(afterRedo(state)).toEqual({ undo: [a, b], redo: [] });
    expect(pushAction(state, b).redo).toEqual([]);
  });
  it("records only the ids whose lock state actually changes", () => {
    const entries = [
      { id: "a", isLocked: false },
      { id: "b", isLocked: true },
      { id: "c", isLocked: false },
    ];
    expect(idsToChange(entries, ["a", "b"], true)).toEqual(["a"]);
    expect(idsToChange(entries, ["a", "b", "c"], false)).toEqual(["b"]);
  });
  it("applies changedEntries to the entry list", () => {
    const entries = [
      { id: "a", periodNumber: 1 },
      { id: "b", periodNumber: 2 },
    ];
    expect(applyChangedEntries(entries, [{ id: "b", periodNumber: 5 }])).toEqual([
      { id: "a", periodNumber: 1 },
      { id: "b", periodNumber: 5 },
    ]);
  });
});

describe("publish gate", () => {
  const validation = { revision: 3, valid: true, isStale: false, violationCount: 0, informational: { publishable: true } } as never;
  const draft = { status: "DRAFT" as const, revision: 3 };
  it("allows a valid, current draft whose validation matches its revision", () => {
    expect(publishGate({ version: draft, validation, canPublish: true, publishedKnown: true })).toEqual({ allowed: true });
  });
  it("does not trust validation of another revision", () => {
    expect(publishGate({ version: { ...draft, revision: 4 }, validation, canPublish: true, publishedKnown: true })).toMatchObject({ allowed: false, kind: "checking" });
  });
  it("blocks stale, invalid and non-draft versions and completed years", () => {
    const v = (patch: object) => ({ ...(validation as object), ...patch }) as never;
    expect(publishGate({ version: draft, validation: v({ isStale: true }), canPublish: true, publishedKnown: true })).toMatchObject({ kind: "stale" });
    expect(publishGate({ version: draft, validation: v({ valid: false, violationCount: 2 }), canPublish: true, publishedKnown: true })).toMatchObject({ kind: "invalid" });
    expect(publishGate({ version: { ...draft, status: "PUBLISHED" }, validation, canPublish: true, publishedKnown: true })).toMatchObject({ kind: "not-draft" });
    expect(publishGate({ version: draft, validation, canPublish: false, publishedKnown: true })).toMatchObject({ kind: "year" });
    expect(publishGate({ version: draft, validation, canPublish: true, publishedKnown: false })).toMatchObject({ kind: "unknown-published" });
  });
});

describe("versions list rules", () => {
  it("derives the staleness label for drafts only", () => {
    expect(staleState({ status: "DRAFT", isStale: true })).toBe("stale");
    expect(staleState({ status: "DRAFT", isStale: false })).toBe("current");
    expect(staleState({ status: "DRAFT", isStale: null })).toBe("unknown");
    expect(staleState({ status: "PUBLISHED", isStale: true })).toBe("not-applicable");
  });
  it("never offers delete for the published version (P6)", () => {
    expect(deleteKind("DRAFT")).toBe("draft");
    expect(deleteKind("ARCHIVED")).toBe("archived");
    expect(deleteKind("PUBLISHED")).toBeNull();
  });
  it("gates editing on draft status, year and viewport", () => {
    expect(editGate({ versionStatus: "DRAFT", canEditVersions: true, wideEnough: true, yearName: "y" })).toEqual({ editable: true });
    expect(editGate({ versionStatus: "PUBLISHED", canEditVersions: true, wideEnough: true, yearName: "y" }).editable).toBe(false);
    expect(editGate({ versionStatus: "DRAFT", canEditVersions: false, wideEnough: true, yearName: "y" }).editable).toBe(false);
    expect(editGate({ versionStatus: "DRAFT", canEditVersions: true, wideEnough: false, yearName: "y" }).editable).toBe(false);
  });
});
