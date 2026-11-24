"use client";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { isApiError } from "@/lib/api/errors";
import type { Absence } from "@/lib/api/schemas";
import { formatDateRange } from "@/lib/dates";
import { plural } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/notify";
import { absenceScopeLabel, lessonsFromDetails } from "../board-rules";
import { useCancelAbsence } from "../hooks";
import { RefusalWithLessons } from "./cover-badges";

/** POST /teacher-absences/:id/cancel. Blocked only by manual assignments (ASSIGNED_COVERS_EXIST lists them). */
export function CancelAbsenceDialog({ absence, teacherName, onOpenChange }: { absence: Absence | null; teacherName: string; onOpenChange: (open: boolean) => void }) {
  const cancel = useCancelAbsence();
  return (
    <ConfirmDialog
      open={absence !== null}
      onOpenChange={onOpenChange}
      title="Cancel this absence?"
      description={
        absence ? (
          <>
            <span className="font-medium text-foreground">{teacherName}</span> · {formatDateRange(absence.startDate, absence.endDate)} · {absenceScopeLabel(absence)}. Lessons
            still needing cover and automatic substitutes are cancelled with it. The absence stays in the list as cancelled.
          </>
        ) : null
      }
      confirmLabel="Cancel absence"
      cancelLabel="Keep absence"
      destructive
      onConfirm={async () => {
        if (!absence) return;
        try {
          const result = await cancel.mutateAsync(absence.id);
          notifySuccess(
            "Absence cancelled",
            `${plural(result.coverRequestsCancelled, "lesson")} no longer need${result.coverRequestsCancelled === 1 ? "s" : ""} cover.`,
          );
        } catch (error) {
          if (isApiError(error) && error.uncertain) notifyError(error, "Couldn’t confirm the cancellation");
          throw error;
        }
      }}
      errorRender={(error) =>
        isApiError(error) && error.code === "ASSIGNED_COVERS_EXIST" ? (
          <RefusalWithLessons message={error.message} lessons={lessonsFromDetails(error.details)} footer={<p>Unassign or cancel these covers on the daily cover board first.</p>} />
        ) : isApiError(error) ? (
          error.message
        ) : (
          "Something went wrong. Please try again."
        )
      }
    />
  );
}
