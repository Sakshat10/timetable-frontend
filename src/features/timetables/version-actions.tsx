"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConfirmDialog, PendingButton } from "@/components/shared/confirm-dialog";
import { FormAlert } from "@/components/shared/form-fields";
import { useYear } from "@/features/academic-years/year-context";
import { versionsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { LockMode, VersionSummary } from "@/lib/api/types";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";

const LOCK_MODES: Array<{ value: LockMode; label: string; description: string }> = [
  { value: "KEEP", label: "Keep locks as they are", description: "Lessons locked in the original stay locked in the copy." },
  { value: "ALL", label: "Lock every lesson", description: "Useful as a starting point for regenerating around the whole timetable." },
  { value: "NONE", label: "Unlock every lesson", description: "Every lesson in the copy can be moved." },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** P5: "Copy to new draft" (clone). Never called "restore". Not idempotent: an uncertain outcome refetches the list. */
export function CloneVersionDialog({ version, open, onOpenChange }: { version: Pick<VersionSummary, "id" | "versionNumber" | "status">; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { year, basePath } = useYear();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lockMode, setLockMode] = useState<LockMode>("KEEP");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      let attempt = 0;
      for (;;) {
        try {
          const result = await versionsApi.clone(version.id, { lockMode });
          await queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
          notifySuccess(`Copied to draft version ${result.versionNumber}`, `A copy of version ${version.versionNumber}.`);
          onOpenChange(false);
          router.push(`${basePath}/timetables/${result.id}`);
          return;
        } catch (e) {
          // 503 BUSY: nothing was applied, so the same request may be retried after Retry-After (at most 3 times).
          if (isApiError(e) && e.status === 503 && e.code === "BUSY" && attempt < 3) {
            attempt += 1;
            await sleep(e.retryAfterMs ?? 2_000);
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (isApiError(e) && e.uncertain) {
        await queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
        notifyError(e, "Couldn’t confirm the copy");
        onOpenChange(false);
      } else if (isApiError(e) && e.code === "DRAFT_LIMIT_REACHED") {
        const max = typeof e.details.maxDraftsPerYear === "number" ? e.details.maxDraftsPerYear : null;
        setError(`This year already has the maximum number of drafts${max !== null ? ` (${max})` : ""}. Delete a draft you no longer need, then copy again.`);
      } else if (isApiError(e) && e.code === "ACADEMIC_YEAR_NOT_EDITABLE") {
        setError(`${year.name} is completed, so no new drafts can be created.`);
      } else {
        setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy version {version.versionNumber} to a new draft</DialogTitle>
          <DialogDescription>
            The copy is a new draft with the same lessons. Version {version.versionNumber} itself is not changed. A copy is based on the same setup as the
            original, so if the setup has changed since, the copy is out of date too and can’t be published.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Locked lessons in the copy</legend>
          <RadioGroup value={lockMode} onValueChange={(v) => setLockMode(v as LockMode)}>
            {LOCK_MODES.map((mode) => (
              <div key={mode.value} className="flex items-start gap-2.5">
                <RadioGroupItem value={mode.value} id={`lock-mode-${mode.value}`} className="mt-0.5" />
                <Label htmlFor={`lock-mode-${mode.value}`} className="flex flex-col items-start gap-0.5 font-normal">
                  <span className="font-medium">{mode.label}</span>
                  <span className="text-xs text-muted-foreground">{mode.description}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <PendingButton pending={pending} onClick={() => void submit()}>
            Copy to new draft
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function versionDeleteError(error: unknown, versionNumber: number) {
  if (!isApiError(error)) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "CONFIRMATION_MISMATCH":
      return `The number typed does not match. Type ${versionNumber} to confirm.`;
    case "STATUS_CHANGED":
      return "This version’s status changed meanwhile. The list has been refreshed; check it and try again.";
    case "REVISION_CONFLICT":
      return "This version was changed meanwhile. The list has been refreshed; try again.";
    case "CONFIRMATION_REQUIRED":
      return "This version is no longer a draft (it may have been published). The list has been refreshed.";
    case "ACADEMIC_YEAR_NOT_EDITABLE":
      return "This academic year is completed, so its versions can’t be deleted.";
    case "VERSION_HAS_HISTORY": {
      const counts = error.details.coverRequests && typeof error.details.coverRequests === "object" ? (error.details.coverRequests as Record<string, number>) : {};
      const total = typeof error.details.coverRequestTotal === "number" ? error.details.coverRequestTotal : null;
      const parts = Object.entries(counts).map(([status, n]) => `${n} ${status.toLowerCase()}`);
      return `This version can’t be deleted because substitute cover was arranged from it${total !== null ? ` (${total} cover request${total === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""})` : ""}. Cover history is never erased.`;
    }
    case "BUSY":
      return "The server is busy with another change to this year. Try again in a moment.";
    default:
      return error.message;
  }
}

/** DRAFT: no body. ARCHIVED: typed confirmation with {confirmVersionNumber, expectedStatus, expectedRevision}. Never PUBLISHED (P6). */
export function DeleteVersionDialog({
  version,
  open,
  onOpenChange,
  onDeleted,
}: {
  version: Pick<VersionSummary, "id" | "versionNumber" | "status" | "revision">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const { year } = useYear();
  const queryClient = useQueryClient();
  const archived = version.status === "ARCHIVED";
  if (version.status === "PUBLISHED") return null;

  async function remove() {
    try {
      if (archived) {
        await versionsApi.removeArchived(version.id, { confirmVersionNumber: version.versionNumber, expectedStatus: "ARCHIVED", expectedRevision: version.revision });
      } else {
        await versionsApi.removeDraft(version.id);
      }
    } catch (e) {
      if (isApiError(e) && (e.uncertain || ["STATUS_CHANGED", "REVISION_CONFLICT", "CONFIRMATION_REQUIRED"].includes(e.code ?? ""))) {
        await queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
      }
      if (isApiError(e) && e.uncertain) {
        notifyInfo("Couldn’t confirm the deletion", "The server’s answer was lost. The list has been refreshed; check whether the version is still there.");
        return;
      }
      throw e;
    }
    queryClient.removeQueries({ queryKey: qk.version(version.id) });
    await queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
    notifySuccess(`Version ${version.versionNumber} deleted`);
    onDeleted?.();
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${archived ? "archived " : "draft "}version ${version.versionNumber}?`}
      description={
        archived
          ? "This archived version and its lessons will be permanently deleted. This can’t be undone."
          : "This draft and its lessons will be permanently deleted. This can’t be undone."
      }
      confirmLabel={`Delete version ${version.versionNumber}`}
      destructive
      typedConfirmation={archived ? String(version.versionNumber) : undefined}
      onConfirm={remove}
      errorRender={(error) => versionDeleteError(error, version.versionNumber)}
    />
  );
}
