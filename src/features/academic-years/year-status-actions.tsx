"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { yearsApi } from "@/lib/api/endpoints";
import type { AcademicYear } from "@/lib/api/types";
import { notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";

/**
 * DRAFT → ACTIVE. Irreversible (PHASE-0-AUDIT §1.2): it ends timetable generation for the year and locks its
 * setup. There is no undo or deactivation anywhere in the product. Typed confirmation required
 * (CAPABILITY-BOUNDARIES.md, "Academic-year activation").
 */
export function ActivateYearDialog({ year, open, onOpenChange }: { year: AcademicYear; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => yearsApi.update(year.id, { status: "ACTIVE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.years() });
      notifySuccess(`${year.name} is now active`);
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Activate ${year.name}? This cannot be undone.`}
      description="Activate a year when its timetable is final and the school year is starting."
      confirmLabel={`Activate ${year.name}`}
      destructive
      typedConfirmation={year.name}
      onConfirm={() => mutation.mutateAsync()}
    >
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>
          <span className="font-medium text-foreground">Timetable generation ends for this year.</span> You will not be able to generate or regenerate a timetable for {year.name} again.
        </li>
        <li>Classes, curriculum, teacher grade eligibility, assignments and the weekly schedule become read-only.</li>
        <li>Existing drafts can still be adjusted (move, swap, lock) and published.</li>
        <li>The year can never return to draft. Later you can only mark it completed.</li>
      </ul>
    </ConfirmDialog>
  );
}

/** ACTIVE → COMPLETED. Also one-way: the year and its timetables become read-only. */
export function CompleteYearDialog({ year, open, onOpenChange }: { year: AcademicYear; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => yearsApi.update(year.id, { status: "COMPLETED" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.years() });
      notifySuccess(`${year.name} is now completed`);
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark ${year.name} as completed? This cannot be undone.`}
      description="Completed years are kept as read-only history."
      confirmLabel={`Complete ${year.name}`}
      destructive
      typedConfirmation={year.name}
      onConfirm={() => mutation.mutateAsync()}
    >
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>Its timetables can no longer be edited or published.</li>
        <li>Daily cover no longer uses this year’s timetable.</li>
        <li>The year cannot be made active again.</li>
      </ul>
    </ConfirmDialog>
  );
}
