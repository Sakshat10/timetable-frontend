"use client";

import { useState } from "react";
import { ConfirmDialog, DeleteRecordDialog } from "@/components/shared/confirm-dialog";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { Teacher } from "@/lib/api/types";
import { useDeleteTeacher, useUpdateTeacher } from "./hooks";
import { TeacherFormDialog } from "./teacher-form-dialog";

type TeacherRef = Pick<Teacher, "id" | "name" | "employeeCode" | "isActive">;
export type TeacherAction = { kind: "edit" | "status" | "delete"; teacher: TeacherRef } | null;

/** Edit, deactivate/reactivate and delete dialogs for one teacher at a time (shared by the list and detail pages). */
export function useTeacherActions(yearId: string, options: { onDeleted?: (teacher: TeacherRef) => void } = {}) {
  const [action, setAction] = useState<TeacherAction>(null);
  const update = useUpdateTeacher(yearId);
  const remove = useDeleteTeacher(yearId);
  const close = (open: boolean) => (!open ? setAction(null) : undefined);
  const teacher = action?.teacher;

  async function toggleActive() {
    if (!teacher) return;
    const isActive = !teacher.isActive;
    try {
      await update.mutateAsync({ id: teacher.id, body: { isActive } });
      notifySuccess(isActive ? "Teacher reactivated" : "Teacher deactivated", teacher.name);
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, "Couldn’t confirm the change");
        return;
      }
      throw error;
    }
  }

  async function deleteTeacher() {
    if (!teacher) return;
    try {
      const result = await remove.mutateAsync(teacher.id);
      notifySuccess("Teacher deleted", teacher.name);
      options.onDeleted?.(teacher);
      return result;
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, "Couldn’t confirm the deletion");
        return;
      }
      throw error;
    }
  }

  const dialogs = (
    <>
      <TeacherFormDialog open={action?.kind === "edit"} onOpenChange={close} yearId={yearId} teacher={action?.kind === "edit" ? teacher : null} />
      <ConfirmDialog
        open={action?.kind === "status"}
        onOpenChange={close}
        title={teacher?.isActive ? `Deactivate ${teacher?.name}?` : `Reactivate ${teacher?.name}?`}
        description={
          teacher?.isActive
            ? "The teacher and their history are kept. You can reactivate them at any time."
            : "The teacher can be pinned to classes and chosen by the generator again."
        }
        confirmLabel={teacher?.isActive ? "Deactivate" : "Reactivate"}
        destructive={teacher?.isActive}
        onConfirm={toggleActive}
      >
        {teacher?.isActive ? (
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>They can’t be pinned to new classes.</li>
            <li>The generator never chooses them automatically.</li>
            <li>Existing pins stay, but generating a timetable is refused until those pins are changed or the teacher is reactivated.</li>
          </ul>
        ) : null}
      </ConfirmDialog>
      <DeleteRecordDialog
        open={action?.kind === "delete"}
        onOpenChange={close}
        what="teacher"
        name={teacher?.name ?? ""}
        onDelete={deleteTeacher}
        consequence={
          <p className="text-muted-foreground">
            Only a teacher with no history (no pins, timetable lessons, absences or covers) can be deleted. Their subject qualifications are removed with
            them. To keep their history, deactivate them instead.
          </p>
        }
      />
    </>
  );

  return { open: setAction, dialogs };
}
