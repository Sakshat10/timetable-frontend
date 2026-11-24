"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BlockedByList, PendingButton } from "@/components/shared/confirm-dialog";
import { FormAlert } from "@/components/shared/form-fields";
import { EmptyState } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { curriculumApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { CurriculumGrade, CurriculumGroup, ReplaceCurriculumResult } from "@/lib/api/schemas";
import type { Subject } from "@/lib/api/types";
import { notifyError, notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { splitServerErrors, type PathErrors } from "./form-errors";
import { FieldMessage, InfoNote } from "./shared-ui";
import {
  buildReplaceBody,
  demandStatus,
  describeChanges,
  emptyLine,
  lineErrorPaths,
  linesFromGroup,
  linesTotal,
  MAX_CURRICULUM_SUBJECTS,
  PERIODS_MAX,
  sectionDemandFromLines,
  summarisePlan,
  updateDetail,
  validateLines,
  type EditorLine,
} from "./rules";

export interface EditorTarget {
  grade: CurriculumGrade;
  group: CurriculumGroup;
}

export function CurriculumEditor({
  target,
  onClose,
  subjects,
  subjectsHref,
  weeklySlots,
  draftCount,
  invalidate,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  subjects: readonly Subject[];
  subjectsHref: string;
  weeklySlots: number | null;
  draftCount: number;
  invalidate: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Sheet open={target !== null} onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <SheetContent className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {target ? (
          <EditorBody
            key={`${target.grade.id}:${target.group.streamId ?? "-"}`}
            target={target}
            subjects={subjects}
            subjectsHref={subjectsHref}
            weeklySlots={weeklySlots}
            draftCount={draftCount}
            invalidate={invalidate}
            onClose={onClose}
            pending={pending}
            setPending={setPending}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EditorBody({
  target,
  subjects,
  subjectsHref,
  weeklySlots,
  draftCount,
  invalidate,
  onClose,
  pending,
  setPending,
}: {
  target: EditorTarget;
  subjects: readonly Subject[];
  subjectsHref: string;
  weeklySlots: number | null;
  draftCount: number;
  invalidate: () => Promise<void>;
  onClose: () => void;
  pending: boolean;
  setPending: (p: boolean) => void;
}) {
  const { grade, group } = target;
  const [lines, setLines] = useState<EditorLine[]>(() => (group.requirements.length > 0 ? linesFromGroup(group) : [emptyLine()]));
  const [errors, setErrors] = useState<PathErrors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [plan, setPlan] = useState<ReplaceCurriculumResult | null>(null);
  const sectionIds = useMemo(() => group.sections.map((s) => s.id), [group.sections]);
  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name)), [subjects]);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name ?? "Subject";
  const demand = sectionDemandFromLines(lines, sectionIds);

  const change = (index: number, patch: Partial<EditorLine>, clear: string[]) => {
    setLines((c) => c.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setErrors((c) => {
      const next = { ...c };
      for (const f of clear) delete next[`requirements.${index}.${f}`];
      return next;
    });
  };

  async function send(dryRun: boolean) {
    if (pending) return;
    setFormError(null);
    const local = validateLines(lines, sectionIds);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setPlan(null);
      setFormError(local.requirements ?? "Fix the highlighted rows.");
      return;
    }
    setPending(true);
    try {
      const result = await curriculumApi.replace(grade.id, buildReplaceBody(group.streamId, lines, dryRun));
      setPending(false);
      if (dryRun) {
        setPlan(result);
        return;
      }
      await invalidate();
      const summary = summarisePlan(result.plan);
      notifySuccess(`Curriculum of ${group.label} saved`, summary.hasChanges ? summary.sentence.replace("This will", "Changes:") : undefined);
      onClose();
    } catch (error) {
      setPending(false);
      if (isApiError(error) && error.uncertain) {
        await invalidate();
        notifyError(error);
        onClose();
        return;
      }
      const known = lineErrorPaths(lines);
      const { byPath, leftovers } = splitServerErrors(error, (p) => known.has(p));
      setErrors(byPath);
      setPlan(null);
      if (isApiError(error) && Array.isArray(error.details.blockedBy)) setFormError(error);
      else if (leftovers.length > 0) setFormError(leftovers.join(" "));
      else if (Object.keys(byPath).length > 0) setFormError("The server found problems in the highlighted rows. Nothing was changed.");
      else setFormError(error);
    }
  }

  const alert = formError ? typeof formError === "string" ? formError : <BlockedByList error={formError} /> : null;

  if (plan) {
    const summary = summarisePlan(plan.plan);
    return (
      <>
        <SheetHeader className="border-b">
          <SheetTitle>Review changes: {group.label}</SheetTitle>
          <SheetDescription>{summary.sentence} Nothing has been saved yet.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          {summary.hasChanges ? (
            <>
              <PlanList title="Added" tone="success" items={plan.plan.create.map((c) => ({ key: c.subjectId, name: c.subjectName ?? subjectName(c.subjectId), detail: c.periodsPerWeek !== undefined ? plural(c.periodsPerWeek, "period") + " a week" : "" }))} />
              <PlanList
                title="Changed"
                tone="info"
                items={plan.plan.update.map((u) => {
                  const d = updateDetail(u);
                  const periods = d.fromPeriods !== undefined && d.toPeriods !== undefined && d.fromPeriods !== d.toPeriods ? `${d.fromPeriods} → ${d.toPeriods} periods a week` : null;
                  return { key: u.id, name: u.subjectName || subjectName(u.subjectId), detail: periods ? `${periods}; ${describeChanges(u.changes)}` : `Changes: ${describeChanges(u.changes)}` };
                })}
              />
              <PlanList title="Removed" tone="danger" items={plan.plan.remove.map((r) => ({ key: r.id, name: r.subjectName, detail: `was ${plural(r.periodsPerWeek, "period")} a week` }))} />
              {summary.unchanged > 0 ? <p className="text-sm text-muted-foreground">{plural(summary.unchanged, "subject")} unchanged.</p> : null}
              <InfoNote>
                <p>
                  Applying changes the generation input of {grade.name}.{" "}
                  {draftCount > 0
                    ? `The ${plural(draftCount, "existing timetable draft")} will be out of date and can’t be published until generated again.`
                    : "Any timetable draft made before this change would be out of date and could not be published until generated again."}{" "}
                  Teacher assignments are not changed.
                </p>
              </InfoNote>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Go back to make changes, or close the editor.</p>
          )}
          <FormAlert>{alert}</FormAlert>
        </div>
        <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => setPlan(null)} disabled={pending}>
            <ArrowLeft /> Back to editing
          </Button>
          <PendingButton onClick={() => void send(false)} pending={pending} disabled={!summary.hasChanges}>
            Apply changes
          </PendingButton>
        </SheetFooter>
      </>
    );
  }

  const chosen = new Set(lines.map((l) => l.subjectId).filter(Boolean));

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>Edit curriculum: {group.label}</SheetTitle>
        <SheetDescription>
          The list below becomes the complete curriculum of {group.label}: subjects you remove are removed. You’ll review the changes before anything is saved.
        </SheetDescription>
      </SheetHeader>
      <div className="space-y-4 p-4">
        {subjects.length === 0 ? (
          <EmptyState
            compact
            title="No subjects yet"
            description="Add the school’s subjects first, then come back to set the curriculum."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={subjectsHref}>Go to Subjects</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ol className="grid gap-3" aria-label="Subjects in this curriculum">
              {lines.map((line, i) => {
                const p = `requirements.${i}`;
                const rowLabel = line.subjectId ? subjectName(line.subjectId) : `Row ${i + 1}`;
                return (
                  <li key={line.key} className="rounded-lg border bg-surface p-3">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start">
                      <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                        <span className="text-xs font-medium text-muted-foreground" aria-hidden>
                          Subject
                        </span>
                        <Select value={line.subjectId} onValueChange={(v) => change(i, { subjectId: v }, ["subjectId"])}>
                          <SelectTrigger className="w-full" aria-label={`Row ${i + 1} subject`} aria-invalid={errors[`${p}.subjectId`] ? true : undefined}>
                            <SelectValue placeholder="Choose a subject" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedSubjects.map((s) => (
                              <SelectItem key={s.id} value={s.id} disabled={chosen.has(s.id) && s.id !== line.subjectId}>
                                {s.name} ({s.code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors[`${p}.subjectId`] ? <FieldMessage>{errors[`${p}.subjectId`]}</FieldMessage> : null}
                      </div>
                      <PeriodsInput
                        rowLabel={rowLabel}
                        value={line.periodsPerWeek}
                        error={errors[`${p}.periodsPerWeek`]}
                        onChange={(v) => change(i, { periodsPerWeek: v }, ["periodsPerWeek"])}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="justify-self-end sm:mt-6"
                        aria-label={`Remove ${rowLabel}`}
                        onClick={() => {
                          setLines((c) => c.filter((_, j) => j !== i));
                          setErrors({});
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox id={`${line.key}-optional`} checked={line.isOptional} onCheckedChange={(v) => change(i, { isOptional: v === true }, ["isOptional"])} />
                        <Label htmlFor={`${line.key}-optional`} className="text-sm font-normal">
                          Optional (label only; scheduled like other subjects)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground" aria-hidden>
                          Taught in
                        </span>
                        <Select
                          value={line.sectionScope}
                          onValueChange={(v) => change(i, { sectionScope: v as EditorLine["sectionScope"], sectionIds: v === "ALL_SECTIONS" ? [] : line.sectionIds }, ["sectionScope", "sectionIds"])}
                        >
                          <SelectTrigger size="sm" className="w-44" aria-label={`${rowLabel}: taught in`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL_SECTIONS">All sections</SelectItem>
                            <SelectItem value="SELECTED_SECTIONS" disabled={group.sections.length === 0}>
                              Selected sections
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {line.sectionScope === "SELECTED_SECTIONS" ? (
                      <fieldset className="mt-3 space-y-2">
                        <legend className="text-xs font-medium text-muted-foreground">Sections that have {rowLabel}</legend>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {group.sections.map((s) => {
                            const id = `${line.key}-${s.id}`;
                            return (
                              <div key={s.id} className="flex items-center gap-2">
                                <Checkbox
                                  id={id}
                                  checked={line.sectionIds.includes(s.id)}
                                  onCheckedChange={(v) =>
                                    change(i, { sectionIds: v === true ? [...line.sectionIds, s.id] : line.sectionIds.filter((x) => x !== s.id) }, ["sectionIds"])
                                  }
                                />
                                <Label htmlFor={id} className="text-sm font-normal">
                                  {s.name}
                                </Label>
                              </div>
                            );
                          })}
                        </div>
                        {errors[`${p}.sectionIds`] ? <FieldMessage>{errors[`${p}.sectionIds`]}</FieldMessage> : null}
                      </fieldset>
                    ) : null}
                    {errors[`${p}.sectionScope`] ? <FieldMessage>{errors[`${p}.sectionScope`]}</FieldMessage> : null}
                  </li>
                );
              })}
            </ol>
            {lines.length === 0 ? <p className="text-sm text-muted-foreground">No subjects: reviewing will show every current subject being removed.</p> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((c) => [...c, emptyLine()])} disabled={lines.length >= MAX_CURRICULUM_SUBJECTS}>
              <Plus /> Add subject
            </Button>

            <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="tabular">
                <span className="font-medium text-foreground">{linesTotal(lines)}</span> periods a week in total
                {weeklySlots !== null ? <span className="text-muted-foreground"> · the schedule has {weeklySlots} slots a week</span> : <span className="text-muted-foreground"> · no schedule yet, so weekly slots are unknown</span>}
              </p>
              {group.sections.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label="Weekly periods per section">
                  {group.sections.map((s) => {
                    const value = demand.get(s.id) ?? 0;
                    const status = demandStatus(value, weeklySlots);
                    return (
                      <li key={s.id}>
                        <StatusBadge tone={status === "over" ? "danger" : status === "exact" ? "success" : "neutral"} dot={false}>
                          {s.name}: {value}
                          {weeklySlots !== null ? ` / ${weeklySlots}` : ""}
                          {status === "over" ? " (too many)" : ""}
                        </StatusBadge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground">{group.label} has no sections yet, so nothing will be scheduled for it.</p>
              )}
            </div>
          </>
        )}
        <FormAlert>{alert}</FormAlert>
      </div>
      <SheetFooter className="flex-row flex-wrap justify-end gap-2 border-t">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <PendingButton onClick={() => void send(true)} pending={pending} disabled={subjects.length === 0}>
          <Pencil /> Review changes
        </PendingButton>
      </SheetFooter>
    </>
  );
}

function PeriodsInput({ rowLabel, value, error, onChange }: { rowLabel: string; value: string; error?: string; onChange: (v: string) => void }) {
  const n = Number(value);
  const step = (delta: number) => {
    const base = Number.isInteger(n) && value.trim() !== "" ? n : 0;
    onChange(String(Math.min(PERIODS_MAX, Math.max(1, base + delta))));
  };
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground" aria-hidden>
        Periods / week
      </span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon-sm" aria-label={`Fewer periods for ${rowLabel}`} onClick={() => step(-1)} tabIndex={-1}>
          <Minus />
        </Button>
        <input
          aria-label={`${rowLabel}: periods per week`}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          className="tabular h-8 w-12 rounded-lg border border-input bg-transparent px-2 text-center text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <Button type="button" variant="outline" size="icon-sm" aria-label={`More periods for ${rowLabel}`} onClick={() => step(1)} tabIndex={-1}>
          <Plus />
        </Button>
      </div>
      {error ? <FieldMessage>{error}</FieldMessage> : null}
    </div>
  );
}

function PlanList({ title, tone, items }: { title: string; tone: "success" | "info" | "danger"; items: Array<{ key: string; name: string; detail: string }> }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={`${title} subjects`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <StatusBadge tone={tone}>{title}</StatusBadge>
        <span className="text-muted-foreground tabular">{items.length}</span>
      </h3>
      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
            <span className="font-medium text-foreground">{item.name}</span>
            <span className="text-muted-foreground">{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
