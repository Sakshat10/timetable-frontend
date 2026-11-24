"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { applyServerErrors, FormAlert, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { yearsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { AcademicYear } from "@/lib/api/types";
import { isIsoDate, isoDatePart } from "@/lib/dates";
import { notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";

// Mirrors src/modules/academic-year/academic-year.schema.ts (+ the service's "dates cannot be the same").
export const yearSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name, e.g. 2027-28").max(50, "At most 50 characters"),
    startDate: z.string().refine(isIsoDate, "Choose a start date"),
    endDate: z.string().refine(isIsoDate, "Choose an end date"),
  })
  .refine((v) => !isIsoDate(v.startDate) || !isIsoDate(v.endDate) || v.endDate > v.startDate, { path: ["endDate"], message: "The end date must be after the start date" });
export type YearValues = z.infer<typeof yearSchema>;

const FIELDS = ["name", "startDate", "endDate"] as const;

/** Create or edit an academic year's name and dates. Status changes have their own confirmation flows. */
export function YearFormDialog({
  open,
  onOpenChange,
  year,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year?: AcademicYear;
  onSaved?: (year: AcademicYear) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <YearFormBody year={year} onDone={(saved) => { onOpenChange(false); onSaved?.(saved); }} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function YearFormBody({ year, onDone, onCancel }: { year?: AcademicYear; onDone: (year: AcademicYear) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<YearValues>({
    resolver: zodResolver(yearSchema),
    defaultValues: year ? { name: year.name, startDate: isoDatePart(year.startDate), endDate: isoDatePart(year.endDate) } : { name: "", startDate: "", endDate: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: YearValues) => {
      if (!year) return yearsApi.create(values);
      const changes: Partial<YearValues> = {};
      if (values.name !== year.name) changes.name = values.name;
      if (values.startDate !== isoDatePart(year.startDate)) changes.startDate = values.startDate;
      if (values.endDate !== isoDatePart(year.endDate)) changes.endDate = values.endDate;
      return Object.keys(changes).length ? yearsApi.update(year.id, changes) : Promise.resolve(year);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: qk.years() });
      notifySuccess(year ? "Academic year updated" : `Academic year ${saved.name} created`);
      onDone(saved);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) {
        form.setError("name", { message: error.message });
        return;
      }
      const leftovers = applyServerErrors(error, form.setError, FIELDS);
      setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t save the academic year."));
    },
  });

  return (
    <form onSubmit={form.handleSubmit((values) => { setFormError(null); mutation.mutate(values); })} noValidate className="space-y-5">
      <DialogHeader>
        <DialogTitle>{year ? `Edit ${year.name}` : "New academic year"}</DialogTitle>
        <DialogDescription>{year ? "Change the name or dates." : "New years start as drafts: you can set them up and generate timetables freely."}</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="name" label="Name" placeholder="2027-28" autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={form.control} name="startDate" label="Start date" type="date" />
          <TextField control={form.control} name="endDate" label="End date" type="date" />
        </div>
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={mutation.isPending}>
          {year ? "Save changes" : "Create year"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
