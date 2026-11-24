"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { applyServerErrors, CheckboxField, FormAlert, NumberField, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { isApiError } from "@/lib/api/errors";
import type { Absence, CreateAbsenceResult, UpdateAbsenceResult } from "@/lib/api/schemas";
import type { TeacherListItem } from "@/lib/api/types";
import { formatDateRange, todayUtc } from "@/lib/dates";
import { notifyError, notifySuccess } from "@/lib/notify";
import { ABSENCE_FORM_FIELDS, absenceFormDefaults, absenceFormSchema, toCreateAbsenceBody, toUpdateAbsenceBody, type AbsenceFormValues } from "../absence-form";
import { absenceScopeLabel, lessonsFromDetails, overlappingAbsenceId } from "../board-rules";
import { useCreateAbsence, useUpdateAbsence } from "../hooks";
import { AllocationNotice } from "./allocation-notice";
import { RefusalWithLessons } from "./cover-badges";
import { LessonsPreview } from "./lessons-preview";

type Outcome = { kind: "created"; result: CreateAbsenceResult } | { kind: "updated"; result: UpdateAbsenceResult };

/** Record (POST) or edit (PATCH) an absence. The teacher of an existing absence can never change. */
export function AbsenceFormSheet({
  open,
  onOpenChange,
  absence,
  teachers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing. */
  absence?: Absence | null;
  teachers: TeacherListItem[];
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [formKey, setFormKey] = useState(0);
  const editing = Boolean(absence);

  function change(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setOutcome(null);
      setFormKey((k) => k + 1);
    }
  }

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetContent className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
          <SheetTitle>{outcome ? (outcome.kind === "created" ? "Absence recorded" : "Absence updated") : editing ? "Edit absence" : "Record absence"}</SheetTitle>
          <SheetDescription>
            {editing && absence
              ? `${absence.teacher?.name ?? teachers.find((t) => t.id === absence.teacherId)?.name ?? "Teacher"} · ${formatDateRange(absence.startDate, absence.endDate)} · ${absenceScopeLabel(absence)}`
              : "The server finds the teacher’s lessons in the published timetable and creates the lessons that need cover."}
          </SheetDescription>
        </SheetHeader>
        {outcome ? (
          <OutcomeView outcome={outcome} onClose={() => change(false)} onAnother={editing ? undefined : () => { setOutcome(null); setFormKey((k) => k + 1); }} />
        ) : open ? (
          <AbsenceForm key={formKey} absence={absence ?? null} teachers={teachers} onDone={setOutcome} onCancel={() => change(false)} onUncertain={() => change(false)} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function OutcomeView({ outcome, onClose, onAnother }: { outcome: Outcome; onClose: () => void; onAnother?: () => void }) {
  const absence = outcome.result.absence;
  return (
    <div className="space-y-4 px-4 py-5 sm:px-6">
      {outcome.kind === "created" ? (
        <AllocationNotice
          absenceId={absence.id}
          coverRequestsCreated={outcome.result.coverRequestsCreated}
          datesWithoutPublishedTimetable={outcome.result.datesWithoutPublishedTimetable}
          ambiguousDates={outcome.result.ambiguousDates}
          automaticAllocation={outcome.result.automaticAllocation}
        />
      ) : (
        <AllocationNotice
          absenceId={absence.id}
          coverRequestsCreated={outcome.result.coverRequestsCreated}
          coverRequestsCancelled={outcome.result.coverRequestsCancelled}
          coverRequestsReopened={outcome.result.coverRequestsReopened}
          automaticAllocation={outcome.result.automaticAllocation}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/operations/absences/${absence.id}`}>View absence</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/operations?date=${absence.startDate}`}>Open daily cover</Link>
        </Button>
        {onAnother ? (
          <Button variant="outline" onClick={onAnother}>
            Record another
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function AbsenceForm({
  absence,
  teachers,
  onDone,
  onCancel,
  onUncertain,
}: {
  absence: Absence | null;
  teachers: TeacherListItem[];
  onDone: (outcome: Outcome) => void;
  onCancel: () => void;
  onUncertain: () => void;
}) {
  const form = useForm<AbsenceFormValues>({ resolver: zodResolver(absenceFormSchema), defaultValues: absenceFormDefaults(todayUtc(), absence ?? undefined) });
  const create = useCreateAbsence();
  const update = useUpdateAbsence();
  const inFlight = useRef(false);
  const [alert, setAlert] = useState<ReactNode>(null);
  const pending = create.isPending || update.isPending;
  const [teacherId, startDate, endDate, scope, fromPeriod, toPeriod, autoAssign] = useWatch({
    control: form.control,
    name: ["teacherId", "startDate", "endDate", "scope", "fromPeriod", "toPeriod", "autoAssign"],
  });

  // Keep the end date in step when the start date moves past it (the common single-day case).
  useEffect(() => {
    if (!absence && startDate && endDate && endDate < startDate) form.setValue("endDate", startDate);
  }, [absence, startDate, endDate, form]);

  const teacherOptions = teachers
    .filter((t) => t.isActive || t.id === absence?.teacherId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.employeeCode ? `${t.name} (${t.employeeCode})` : t.name }));

  function explain(error: unknown): ReactNode {
    if (!isApiError(error)) return "Something went wrong. Please try again.";
    if (error.code === "ABSENCE_OVERLAP") {
      const id = overlappingAbsenceId(error.details);
      return (
        <div className="space-y-1">
          <p>{error.message}</p>
          {id ? (
            <Link href={`/operations/absences/${id}`} className="font-medium underline underline-offset-2">
              Open the existing absence
            </Link>
          ) : null}
        </div>
      );
    }
    if (error.code === "TEACHER_IS_COVERING" || error.code === "ASSIGNED_COVERS_OUTSIDE") {
      return <RefusalWithLessons message={error.message} lessons={lessonsFromDetails(error.details)} />;
    }
    const leftovers = applyServerErrors(error, form.setError, ABSENCE_FORM_FIELDS);
    if (Object.keys(error.fieldErrors).length > 0) return leftovers.length > 0 ? leftovers.join(" ") : null;
    return error.message;
  }

  async function submit(values: AbsenceFormValues) {
    if (inFlight.current) return;
    setAlert(null);
    let body;
    if (absence) {
      body = toUpdateAbsenceBody(values, absence);
      if (!body) {
        setAlert("Nothing has changed. Change the dates, periods or reason to save.");
        return;
      }
    }
    inFlight.current = true;
    try {
      if (absence) {
        const result = await update.mutateAsync({ id: absence.id, body: body! });
        notifySuccess("Absence updated");
        onDone({ kind: "updated", result });
      } else {
        const result = await create.mutateAsync(toCreateAbsenceBody(values));
        notifySuccess("Absence recorded");
        onDone({ kind: "created", result });
      }
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        // Never re-send: the lists were re-read; the user checks them first.
        notifyError(error, absence ? "Couldn’t confirm the change" : "Couldn’t confirm the absence was recorded");
        onUncertain();
        return;
      }
      setAlert(explain(error));
    } finally {
      inFlight.current = false;
    }
  }

  const singleDay = startDate === endDate;

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate className="flex flex-1 flex-col">
      <div className="flex-1 space-y-5 px-4 py-5 sm:px-6">
        {alert ? <FormAlert>{alert}</FormAlert> : null}
        <SelectField
          control={form.control}
          name="teacherId"
          label="Teacher"
          options={teacherOptions}
          placeholder="Choose a teacher"
          disabled={Boolean(absence) || pending}
          description={absence ? "The teacher can’t be changed. Cancel this absence and record a new one instead." : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="startDate" label="First day" type="date" disabled={pending} />
          <TextField control={form.control} name="endDate" label="Last day" type="date" disabled={pending} description="At most 366 days." />
        </div>
        <Controller
          control={form.control}
          name="scope"
          render={({ field }) => (
            <Field>
              <FieldLabel id="absence-scope-label">Absent for</FieldLabel>
              <RadioGroup value={field.value} onValueChange={field.onChange} aria-labelledby="absence-scope-label" className="flex flex-wrap gap-4" disabled={pending}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="FULL_DAY" id="absence-scope-full" />
                  <Label htmlFor="absence-scope-full" className="font-normal">
                    Full day
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="PERIODS" id="absence-scope-periods" />
                  <Label htmlFor="absence-scope-periods" className="font-normal">
                    Some periods
                  </Label>
                </div>
              </RadioGroup>
            </Field>
          )}
        />
        {scope === "PERIODS" ? (
          <div className="grid grid-cols-2 gap-4">
            <NumberField control={form.control} name="fromPeriod" label="From period" min={1} max={12} disabled={pending} />
            <NumberField control={form.control} name="toPeriod" label="To period" min={1} max={12} disabled={pending} />
          </div>
        ) : null}
        <TextAreaField control={form.control} name="reason" label="Reason (optional)" rows={2} disabled={pending} />
        <div className="space-y-3 rounded-lg border p-3">
          <CheckboxField control={form.control} name="autoAssign" label="Assign substitutes automatically" description="The server picks substitutes for upcoming lessons. Past dates are never assigned automatically." disabled={pending} />
          <CheckboxField
            control={form.control}
            name="allowTemporaryCover"
            label="Allow temporary (unqualified) cover"
            description="A free teacher who doesn’t teach the subject may cover a lesson for that day only."
            disabled={pending || !autoAssign}
          />
        </div>
        {singleDay && teacherId ? (
          <LessonsPreview teacherId={teacherId} date={startDate} fromPeriod={scope === "PERIODS" ? fromPeriod : undefined} toPeriod={scope === "PERIODS" ? toPeriod : undefined} />
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3 sm:px-6">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Close
        </Button>
        <PendingButton type="submit" pending={pending}>
          {absence ? "Save changes" : "Record absence"}
        </PendingButton>
      </SheetFooter>
    </form>
  );
}
