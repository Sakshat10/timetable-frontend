"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { GripVertical, Loader2, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DayOfWeek, TimetableView, VersionEntry } from "@/lib/api/types";
import { DAY_LABEL, DAY_SHORT, periodLabel, sectionLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { breakAfterPeriods, cellMap, decideDrop, dropHints, sameSlot, slotKey, type DropDecision, type DropHint, type Lesson, type Slot } from "./rules";

export type GridMode = "read" | "edit-moves" | "edit-locks";

interface GridProps {
  view: TimetableView;
  kind: "section" | "teacher";
  mode: GridMode;
  /** Entries of the whole version (for advisory hints). */
  entries: readonly VersionEntry[];
  pendingIds: readonly string[];
  narrow: boolean;
  onDecision: (decision: Exclude<DropDecision, { kind: "none" }>) => void;
  onToggleLock: (lesson: Lesson) => void;
}

const HINT_TEXT: Record<DropHint, string> = { move: "Move here", swap: "Swap", locked: "Locked", "teacher-busy": "Teacher busy" };

function slotText(slot: Slot) {
  return `${DAY_SHORT[slot.dayOfWeek]} ${periodLabel(slot.periodNumber)}`;
}

function lessonSecondary(lesson: Lesson, kind: "section" | "teacher") {
  return kind === "section" ? (lesson.teacher.name ?? "Unknown teacher") : sectionLabel(lesson.section.gradeName, lesson.section.name ?? lesson.section.code ?? "Class");
}

function periodTime(p: TimetableView["grid"]["periods"][number]) {
  return p.startTime && p.endTime ? `${p.startTime}–${p.endTime}` : null;
}

export function TimetableGrid(props: GridProps) {
  const { view, narrow } = props;
  if (narrow) return <DayList view={view} kind={props.kind} />;
  return props.mode === "edit-moves" ? <EditableGrid {...props} /> : <StaticGrid {...props} />;
}

function GridTable({ view, children }: { view: TimetableView; children: (slot: Slot) => ReactNode }) {
  const days = [...view.grid.days].sort((a, b) => a.index - b.index);
  const periods = [...view.grid.periods].sort((a, b) => a.periodNumber - b.periodNumber);
  const breaks = new Set(breakAfterPeriods(periods));
  return (
    <div className="overflow-x-auto rounded-lg border bg-surface" data-testid="timetable-grid">
      <table className="w-full min-w-[720px] table-fixed border-collapse text-sm">
        <caption className="sr-only">Timetable: days across, periods down</caption>
        <thead>
          <tr className="border-b bg-muted/40">
            <th scope="col" className="w-20 px-2 py-2 text-left text-xs font-medium text-muted-foreground">
              Period
            </th>
            {days.map((d) => (
              <th key={d.dayOfWeek} scope="col" className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">
                {DAY_LABEL[d.dayOfWeek]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <Fragment key={p.periodNumber}>
              <tr className="border-b last:border-b-0">
                <th scope="row" className="px-2 py-1.5 text-left align-top text-xs font-medium">
                  {periodLabel(p.periodNumber)}
                  {periodTime(p) ? <span className="block font-normal text-muted-foreground">{periodTime(p)}</span> : null}
                </th>
                {days.map((d) => (
                  <td key={d.dayOfWeek} className="h-20 border-l p-1 align-top">
                    {children({ dayOfWeek: d.dayOfWeek, periodNumber: p.periodNumber })}
                  </td>
                ))}
              </tr>
              {breaks.has(p.periodNumber) ? (
                <tr className="border-b bg-muted/60" data-testid="break-row">
                  <td colSpan={days.length + 1} className="px-2 py-1 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Break
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LessonCard({
  lesson,
  kind,
  slot,
  pending,
  className,
  lockToggle,
  children,
}: {
  lesson: Lesson;
  kind: "section" | "teacher";
  slot: Slot;
  pending?: boolean;
  className?: string;
  lockToggle?: () => void;
  children?: ReactNode;
}) {
  const subject = lesson.subject.name ?? lesson.subject.code ?? "Subject";
  return (
    <div
      className={cn("relative flex h-full min-h-16 flex-col gap-0.5 rounded-md border bg-background px-2 py-1.5", lesson.isLocked && "border-dashed", className)}
      data-testid="lesson"
      data-entry-id={lesson.entryId}
      data-slot={slotKey(slot)}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="truncate font-medium leading-tight" title={subject}>
          {subject}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {pending ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" /> : null}
          {lockToggle ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={lockToggle}
              disabled={pending}
              aria-label={`${lesson.isLocked ? "Unlock" : "Lock"} ${subject}, ${slotText(slot)}`}
              aria-pressed={lesson.isLocked}
            >
              {lesson.isLocked ? <Lock aria-hidden /> : <LockOpen aria-hidden className="text-muted-foreground" />}
            </Button>
          ) : lesson.isLocked ? (
            <Lock className="size-3.5 text-muted-foreground" aria-label="Locked" />
          ) : null}
        </span>
      </div>
      <span className="truncate text-xs text-muted-foreground">{lessonSecondary(lesson, kind)}</span>
      {lesson.source === "MANUAL" ? <span className="text-[11px] font-medium text-info">Manual</span> : null}
      {children}
    </div>
  );
}

function Free() {
  return <span className="flex h-full min-h-16 items-center justify-center text-xs text-muted-foreground">Free</span>;
}

function StaticGrid({ view, kind, mode, pendingIds, onToggleLock }: GridProps) {
  const cells = useMemo(() => cellMap(view), [view]);
  return (
    <GridTable view={view}>
      {(slot) => {
        const lesson = cells.get(slotKey(slot));
        if (!lesson) return <Free />;
        return (
          <LessonCard
            lesson={lesson}
            kind={kind}
            slot={slot}
            pending={pendingIds.includes(lesson.entryId)}
            lockToggle={mode === "edit-locks" ? () => onToggleLock(lesson) : undefined}
          />
        );
      }}
    </GridTable>
  );
}

// ------------------------------------------------------------------ editing (class view only, X7)

interface Selected {
  lesson: Lesson;
  slot: Slot;
}

function EditableGrid({ view, kind, entries, pendingIds, onDecision, onToggleLock }: GridProps) {
  const cells = useMemo(() => cellMap(view), [view]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [dragging, setDragging] = useState<Selected | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [target, setTarget] = useState<{ slot: Slot; occupant: Lesson | null } | null>(null);
  const busy = pendingIds.length > 0;

  const decisionFor = (source: Selected, slot: Slot) => {
    const occupant = cells.get(slotKey(slot)) ?? null;
    return decideDrop({ entryId: source.lesson.entryId, slot: source.slot }, { slot, occupantEntryId: occupant?.entryId ?? null });
  };

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as Selected | undefined;
    setDragging(data ?? null);
    setSelected(null);
    setTarget(null);
  }

  function onDragEnd(event: DragEndEvent) {
    const source = event.active.data.current as Selected | undefined;
    setDragging(null);
    const slot = event.over?.data.current as Slot | undefined;
    if (!source || !slot) return;
    const decision = decisionFor(source, slot);
    if (decision.kind !== "none") onDecision(decision);
  }

  function confirmTarget() {
    if (!selected || !target) return;
    const decision = decisionFor(selected, target.slot);
    setSelected(null);
    setTarget(null);
    if (decision.kind !== "none") onDecision(decision);
  }

  const selectedSubject = selected ? (selected.lesson.subject.name ?? "the lesson") : "";

  return (
    <div className="flex flex-col gap-2">
      {selected ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-accent px-3 py-2 text-sm">
          {target ? (
            <>
              <span>
                {target.occupant
                  ? `Swap ${selectedSubject} (${slotText(selected.slot)}) with ${target.occupant.subject.name ?? "the lesson"} (${slotText(target.slot)})?`
                  : `Move ${selectedSubject} from ${slotText(selected.slot)} to ${slotText(target.slot)}?`}
              </span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={confirmTarget} disabled={busy}>
                  {target.occupant ? "Confirm swap" : "Confirm move"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTarget(null)}>
                  Choose another slot
                </Button>
              </span>
            </>
          ) : (
            <>
              <span>
                {selectedSubject} ({slotText(selected.slot)}) selected. Choose an empty slot to move it to, or another lesson of this class to swap with.
              </span>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => setSelected(null)}>
                Clear selection
              </Button>
            </>
          )}
        </div>
      ) : null}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <GridTable view={view}>
          {(slot) => {
            const lesson = cells.get(slotKey(slot)) ?? null;
            const source = dragging ?? selected;
            const decision = source ? decisionFor(source, slot) : ({ kind: "none" } as const);
            const hints = dragging ? dropHints(decision, entries) : [];
            const isSource = source ? sameSlot(source.slot, slot) : false;
            return (
              <DropCell slot={slot} hints={hints} disabled={busy}>
                {lesson ? (
                  <DraggableLesson
                    lesson={lesson}
                    slot={slot}
                    kind={kind}
                    pending={pendingIds.includes(lesson.entryId)}
                    disabled={busy}
                    isSelected={Boolean(selected && isSource)}
                    dimmed={Boolean(dragging && isSource)}
                    onSelect={() => {
                      setTarget(null);
                      setSelected((s) => (s && s.lesson.entryId === lesson.entryId ? null : { lesson, slot }));
                    }}
                    onToggleLock={() => onToggleLock(lesson)}
                  >
                    {selected && !isSource && !dragging ? (
                      <Button size="xs" variant="outline" className="mt-1 self-start" onClick={() => setTarget({ slot, occupant: lesson })}>
                        Swap here
                      </Button>
                    ) : null}
                  </DraggableLesson>
                ) : selected && !dragging ? (
                  <div className="flex h-full min-h-16 items-center justify-center">
                    <Button size="xs" variant="outline" onClick={() => setTarget({ slot, occupant: null })} aria-label={`Move here: ${slotText(slot)}`}>
                      Move here
                    </Button>
                  </div>
                ) : (
                  <Free />
                )}
              </DropCell>
            );
          }}
        </GridTable>
        <DragOverlay dropAnimation={null}>
          {dragging ? <LessonCard lesson={dragging.lesson} kind={kind} slot={dragging.slot} className="w-40 shadow-md" /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function DropCell({ slot, hints, disabled, children }: { slot: Slot; hints: DropHint[]; disabled: boolean; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: slotKey(slot), data: slot, disabled });
  const warn = hints.includes("locked") || hints.includes("teacher-busy");
  return (
    <div
      ref={setNodeRef}
      data-testid="drop-cell"
      data-slot={slotKey(slot)}
      className={cn("relative h-full rounded-md", isOver && (warn ? "ring-2 ring-warning" : "ring-2 ring-primary"))}
    >
      {children}
      {isOver && hints.length > 0 ? (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-foreground px-1 py-0.5 text-[10px] font-medium text-background">
          {hints.map((h) => HINT_TEXT[h]).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

function DraggableLesson({
  lesson,
  slot,
  kind,
  pending,
  disabled,
  isSelected,
  dimmed,
  onSelect,
  onToggleLock,
  children,
}: {
  lesson: Lesson;
  slot: Slot;
  kind: "section" | "teacher";
  pending: boolean;
  disabled: boolean;
  isSelected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onToggleLock: () => void;
  children?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: lesson.entryId, data: { lesson, slot } satisfies Selected, disabled: disabled || lesson.isLocked });
  const subject = lesson.subject.name ?? "lesson";
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return (
    <div ref={setNodeRef} {...pointerListeners} className={cn("h-full touch-none", dimmed && "opacity-40")}>
      <LessonCard lesson={lesson} kind={kind} slot={slot} pending={pending} lockToggle={onToggleLock} className={cn(isSelected && "ring-2 ring-primary", !lesson.isLocked && "cursor-grab")}>
        <div className="mt-auto flex items-center gap-1">
          {!lesson.isLocked ? (
            <button
              type="button"
              {...attributes}
              onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined}
              aria-roledescription="draggable lesson"
              aria-label={`Drag ${subject}, ${slotText(slot)}`}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <GripVertical className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSelect}
            disabled={disabled || lesson.isLocked}
            aria-pressed={isSelected}
            className="rounded px-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline disabled:hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`${isSelected ? "Deselect" : "Select"} ${subject}, ${slotText(slot)} to move`}
          >
            {isSelected ? "Selected" : "Select"}
          </button>
        </div>
        {children}
      </LessonCard>
    </div>
  );
}

// ------------------------------------------------------------------ mobile: day by day

function DayList({ view, kind }: { view: TimetableView; kind: "section" | "teacher" }) {
  const cells = cellMap(view);
  const days = [...view.grid.days].sort((a, b) => a.index - b.index);
  const periods = [...view.grid.periods].sort((a, b) => a.periodNumber - b.periodNumber);
  const breaks = new Set(breakAfterPeriods(periods));
  return (
    <div className="flex flex-col gap-4" data-testid="timetable-day-list">
      {days.map((d) => (
        <section key={d.dayOfWeek} aria-labelledby={`day-${d.dayOfWeek}`} className="rounded-lg border bg-surface">
          <h3 id={`day-${d.dayOfWeek}`} className="border-b px-3 py-2 text-sm font-semibold">
            {DAY_LABEL[d.dayOfWeek as DayOfWeek]}
          </h3>
          <ol className="divide-y">
            {periods.map((p) => {
              const lesson = cells.get(slotKey({ dayOfWeek: d.dayOfWeek, periodNumber: p.periodNumber }));
              return (
                <Fragment key={p.periodNumber}>
                  <li className="flex items-center gap-3 px-3 py-2">
                    <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">{periodLabel(p.periodNumber)}</span>
                    {lesson ? (
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          {lesson.subject.name ?? lesson.subject.code}
                          {lesson.isLocked ? <Lock className="size-3.5 text-muted-foreground" aria-label="Locked" /> : null}
                          {lesson.source === "MANUAL" ? <span className="text-[11px] font-medium text-info">Manual</span> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{lessonSecondary(lesson, kind)}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Free</span>
                    )}
                  </li>
                  {breaks.has(p.periodNumber) ? <li className="bg-muted/60 px-3 py-1 text-center text-xs font-medium tracking-wide text-muted-foreground uppercase">Break</li> : null}
                </Fragment>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
