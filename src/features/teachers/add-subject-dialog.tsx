"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { applyServerErrors, FormAlert, SelectField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Subject } from "@/lib/api/types";
import { useLinkSubject } from "./hooks";

const schema = z.object({
  subjectId: z.string().min(1, "Choose a subject"),
  type: z.enum(["PRIMARY", "SECONDARY"]),
  gradeScope: z.enum(["SELECTED_GRADES", "ALL_GRADES"]),
});
type Values = z.infer<typeof schema>;

export function AddSubjectDialog({
  open,
  onOpenChange,
  yearId,
  teacherId,
  teacherName,
  subjects,
  linkedSubjectIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  teacherId: string;
  teacherName: string;
  subjects: readonly Subject[];
  linkedSubjectIds: ReadonlySet<string>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <AddSubjectForm
            yearId={yearId}
            teacherId={teacherId}
            teacherName={teacherName}
            subjects={subjects.filter((s) => !linkedSubjectIds.has(s.id))}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddSubjectForm({
  yearId,
  teacherId,
  teacherName,
  subjects,
  onDone,
}: {
  yearId: string;
  teacherId: string;
  teacherName: string;
  subjects: readonly Subject[];
  onDone: () => void;
}) {
  const link = useLinkSubject(yearId, teacherId);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { subjectId: "", type: "PRIMARY", gradeScope: "SELECTED_GRADES" } });
  const pending = form.formState.isSubmitting;

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      const created = await link.mutateAsync(values);
      notifySuccess(
        "Subject added",
        values.gradeScope === "SELECTED_GRADES" ? `Now tick the grades ${teacherName} may teach ${created.subject.name} to.` : undefined,
      );
      onDone();
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, "Couldn’t confirm the subject was added");
        onDone();
        return;
      }
      const leftovers = applyServerErrors(error, form.setError, ["subjectId", "type", "gradeScope"]);
      setFormError(leftovers[0] ?? (isApiError(error) && Object.keys(error.fieldErrors).length === 0 ? error.message : null));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add a subject</DialogTitle>
        <DialogDescription>Record a subject {teacherName} is qualified to teach. This applies in every academic year.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-5">
        <SelectField
          control={form.control}
          name="subjectId"
          label="Subject"
          placeholder={subjects.length === 0 ? "Every subject is already added" : "Choose a subject"}
          disabled={subjects.length === 0}
          options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
        />
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">Type</FieldLegend>
              <FieldDescription>Used only to rank substitutes for absent teachers.</FieldDescription>
              <RadioGroup value={field.value} onValueChange={field.onChange} className="flex gap-6">
                <Field orientation="horizontal" className="w-auto">
                  <RadioGroupItem value="PRIMARY" id="link-type-primary" />
                  <FieldLabel htmlFor="link-type-primary" className="font-normal">
                    Primary
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal" className="w-auto">
                  <RadioGroupItem value="SECONDARY" id="link-type-secondary" />
                  <FieldLabel htmlFor="link-type-secondary" className="font-normal">
                    Secondary
                  </FieldLabel>
                </Field>
              </RadioGroup>
            </FieldSet>
          )}
        />
        <Controller
          control={form.control}
          name="gradeScope"
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant="label">Grades</FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange}>
                <Field orientation="horizontal">
                  <RadioGroupItem value="SELECTED_GRADES" id="link-scope-selected" />
                  <FieldContent>
                    <FieldLabel htmlFor="link-scope-selected" className="font-normal">
                      Selected grades
                    </FieldLabel>
                    <FieldDescription>You tick the grades for each academic year. Until you do, the teacher is not eligible for any grade.</FieldDescription>
                  </FieldContent>
                </Field>
                <Field orientation="horizontal">
                  <RadioGroupItem value="ALL_GRADES" id="link-scope-all" />
                  <FieldContent>
                    <FieldLabel htmlFor="link-scope-all" className="font-normal">
                      All grades
                    </FieldLabel>
                    <FieldDescription>Eligible for every grade in every academic year.</FieldDescription>
                  </FieldContent>
                </Field>
              </RadioGroup>
            </FieldSet>
          )}
        />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={pending} disabled={subjects.length === 0}>
          Add subject
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
