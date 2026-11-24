"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { FormAlert } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { useYear } from "@/features/academic-years/year-context";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifySuccess } from "@/lib/notify";
import { sectionLabel } from "@/lib/format";
import type { SectionAssignment, TeacherListItem } from "@/lib/api/types";
import { useCandidateData, useCreatePin, useRepin, useUnpin } from "./hooks";
import { buildCandidates, pinErrorMessage, type GridGroup, type GridRequirement, type GridSection } from "./rules";

export interface PinTarget {
  group: GridGroup;
  requirement: GridRequirement;
  section: GridSection;
  pin: SectionAssignment | null;
}

export function PinDialog({
  target,
  onOpenChange,
  teachers,
}: {
  target: PinTarget | null;
  onOpenChange: (open: boolean) => void;
  teachers: readonly TeacherListItem[];
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!busy ? onOpenChange(open) : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {target ? <PinForm key={`${target.section.id}:${target.requirement.id}`} target={target} teachers={teachers} onDone={() => onOpenChange(false)} onBusy={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PinForm({
  target,
  teachers,
  onDone,
  onBusy,
}: {
  target: PinTarget;
  teachers: readonly TeacherListItem[];
  onDone: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { year, basePath } = useYear();
  const { group, requirement, section, pin } = target;
  const data = useCandidateData(teachers, requirement.subjectId);
  const candidates = useMemo(
    () =>
      buildCandidates({
        teachers,
        linksByTeacher: data.linksByTeacher,
        gradesByLink: data.gradesByLink,
        subjectId: requirement.subjectId,
        gradeId: group.gradeId,
        gradeName: group.gradeName,
        yearId: year.id,
      }),
    [teachers, data.linksByTeacher, data.gradesByLink, requirement.subjectId, group.gradeId, group.gradeName, year.id],
  );
  const [selected, setSelected] = useState<string>(pin?.teacherId ?? "");
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePin(year.id);
  const repin = useRepin(year.id);
  const unpin = useUnpin(year.id);
  const pending = create.isPending || repin.isPending || unpin.isPending;
  const groupId = useId();
  const classLabel = sectionLabel(group.gradeName, section.name);
  const eligibleCount = candidates.filter((c) => c.status === "eligible").length;
  const loading = candidates.some((c) => c.status === "loading") && !data.error;

  async function run(action: () => Promise<unknown>, success: string) {
    if (pending) return;
    setError(null);
    onBusy(true);
    try {
      await action();
      notifySuccess(success, `${classLabel} · ${requirement.subjectName}`);
      onBusy(false);
      onDone();
    } catch (e) {
      onBusy(false);
      if (isApiError(e) && e.uncertain) {
        notifyError(e, "Couldn’t confirm the change");
        onDone();
        return;
      }
      setError(pinErrorMessage(e));
    }
  }

  const save = () => {
    if (!selected) {
      setError("Choose a teacher to pin.");
      return;
    }
    if (pin) {
      if (selected === pin.teacherId) return onDone();
      void run(() => repin.mutateAsync({ id: pin.id, teacherId: selected }), "Pinned teacher updated");
    } else {
      void run(() => create.mutateAsync({ sectionId: section.id, subjectRequirementId: requirement.id, teacherId: selected }), "Teacher pinned");
    }
  };

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{pin ? "Pinned teacher" : "Pin a teacher"}</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-foreground">{classLabel}</span>
          {group.streamName ? ` (${group.streamName})` : ""} · {requirement.subjectName} · {requirement.periodsPerWeek} periods per week
        </DialogDescription>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">
        {pin
          ? "This class always gets the pinned teacher for this subject. Unpin to let the generator choose automatically again."
          : "Pinning is optional. Without a pin, the generator chooses an eligible teacher when it builds the timetable."}
      </p>

      {pin && !pin.teacher.isActive ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning-foreground dark:text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {pin.teacher.name} is inactive. Generation is refused until this pin is changed or removed, or the teacher is reactivated.
        </div>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Teacher</legend>
        {loading && candidates.length > 0 ? <p className="text-xs text-muted-foreground">Checking eligibility…</p> : null}
        {data.error ? (
          <FormAlert>
            Couldn’t check every teacher’s eligibility.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void data.refetch()}>
              Retry
            </button>
          </FormAlert>
        ) : null}
        {candidates.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
            No teacher is qualified for {requirement.subjectName}. Add the subject to a teacher on the{" "}
            <Link href={`${basePath}/teachers`} className="text-primary hover:underline">
              Teachers
            </Link>{" "}
            page first.
          </p>
        ) : (
          <RadioGroup value={selected} onValueChange={setSelected} aria-label="Teacher" className="max-h-72 gap-1 overflow-y-auto rounded-md border p-1">
            {candidates.map((c) => {
              const id = `${groupId}-${c.teacher.id}`;
              const disabled = c.status !== "eligible" && c.teacher.id !== pin?.teacherId;
              return (
                <div key={c.teacher.id} className="flex items-center gap-3 rounded px-2 py-1.5 hover:bg-muted/50 has-[:disabled]:hover:bg-transparent">
                  <RadioGroupItem value={c.teacher.id} id={id} disabled={disabled || pending} aria-describedby={c.reason ? `${id}-reason` : undefined} />
                  <Label htmlFor={id} className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2 font-normal">
                    <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
                      {c.teacher.name}
                      {c.teacher.employeeCode ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{c.teacher.employeeCode}</span> : null}
                    </span>
                    {c.reason ? (
                      <span id={`${id}-reason`} className="text-xs text-muted-foreground">
                        {c.status === "loading" ? <Skeleton className="inline-block h-3 w-20 align-middle" /> : c.reason}
                      </span>
                    ) : null}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        )}
        <p className="text-xs text-muted-foreground">
          {eligibleCount === 1 ? "1 teacher is" : `${eligibleCount} teachers are`} eligible. Only teachers qualified for {requirement.subjectName} are listed; eligibility for
          a grade is set on each teacher’s page.
        </p>
      </fieldset>

      <FormAlert>{error}</FormAlert>

      <DialogFooter className="gap-2 sm:justify-between">
        {pin ? (
          <PendingButton
            type="button"
            variant="destructive"
            pending={unpin.isPending}
            disabled={pending}
            onClick={() => void run(() => unpin.mutateAsync(pin.id), "Unpinned: chosen automatically at generation")}
          >
            Unpin
          </PendingButton>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <PendingButton type="button" pending={create.isPending || repin.isPending} disabled={pending || !selected || selected === pin?.teacherId} onClick={save}>
            {pin ? "Save pin" : "Pin teacher"}
          </PendingButton>
        </div>
      </DialogFooter>
    </div>
  );
}
