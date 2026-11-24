"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { applyServerErrors, FormAlert, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Teacher } from "@/lib/api/types";
import { useCreateTeacher, useUpdateTeacher } from "./hooks";
import { normaliseEmployeeCode, teacherPatch } from "./rules";

// Mirrors teacher.schema.ts (name 1-200; employee code ≤ 50 after trim, empty clears it).
const schema = z.object({
  name: z.string().trim().min(1, "Enter the teacher’s name").max(200, "At most 200 characters"),
  employeeCode: z.string().trim().max(50, "At most 50 characters"),
});
type Values = z.infer<typeof schema>;
const FIELDS = ["name", "employeeCode"] as const;

export function TeacherFormDialog({
  open,
  onOpenChange,
  yearId,
  teacher,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  /** Edit mode when given. */
  teacher?: Pick<Teacher, "id" | "name" | "employeeCode"> | null;
  onCreated?: (teacher: Teacher) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <TeacherForm key={teacher?.id ?? "new"} yearId={yearId} teacher={teacher ?? null} onDone={() => onOpenChange(false)} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TeacherForm({
  yearId,
  teacher,
  onDone,
  onCreated,
}: {
  yearId: string;
  teacher: Pick<Teacher, "id" | "name" | "employeeCode"> | null;
  onDone: () => void;
  onCreated?: (teacher: Teacher) => void;
}) {
  const create = useCreateTeacher(yearId);
  const update = useUpdateTeacher(yearId);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: teacher?.name ?? "", employeeCode: teacher?.employeeCode ?? "" },
  });
  const pending = form.formState.isSubmitting;

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      if (teacher) {
        const body = teacherPatch(teacher, values);
        if (Object.keys(body).length === 0) {
          onDone();
          return;
        }
        await update.mutateAsync({ id: teacher.id, body });
        notifySuccess("Teacher updated");
      } else {
        const code = normaliseEmployeeCode(values.employeeCode);
        const created = await create.mutateAsync(code === null ? { name: values.name.trim() } : { name: values.name.trim(), employeeCode: code });
        notifySuccess("Teacher added", created.name);
        onCreated?.(created);
      }
      onDone();
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, teacher ? "Couldn’t confirm the update" : "Couldn’t confirm the teacher was added");
        onDone();
        return;
      }
      if (isApiError(error) && error.isConflict) {
        form.setError("employeeCode", { type: "server", message: error.message });
        return;
      }
      const leftovers = applyServerErrors(error, form.setError, FIELDS);
      if (leftovers.length > 0 || Object.keys(isApiError(error) ? error.fieldErrors : {}).length === 0) {
        setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t save. Please try again."));
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{teacher ? "Edit teacher" : "Add teacher"}</DialogTitle>
        <DialogDescription>
          Teachers are shared by every academic year. Subjects and grade eligibility are set on the teacher’s page.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="name" label="Name" autoComplete="off" autoFocus maxLength={200} />
        <TextField
          control={form.control}
          name="employeeCode"
          label="Employee code (optional)"
          autoComplete="off"
          maxLength={50}
          description={teacher?.employeeCode ? "Clear the field to remove the code. Codes are stored in capitals." : "Must be unique in the school. Stored in capitals."}
        />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={pending}>
          {teacher ? "Save changes" : "Add teacher"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
