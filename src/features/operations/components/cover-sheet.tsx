"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ArrowUpRight, Ban, UserMinus } from "lucide-react";
import { ConfirmDialog, PendingButton } from "@/components/shared/confirm-dialog";
import { DetailList } from "@/components/shared/stat-card";
import { ErrorState, ReadOnlyNotice, StaleDataNotice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { isApiError } from "@/lib/api/errors";
import type { CoverDetail } from "@/lib/api/schemas";
import { formatDateLong, formatTimestamp } from "@/lib/dates";
import { sectionLabel } from "@/lib/format";
import { notifyError, notifySuccess } from "@/lib/notify";
import { describeHistory, historyNewestFirst, isReservedCancelReason } from "../board-rules";
import { useCancelCover, useCover, useUnassignCover } from "../hooks";
import { AttentionNote, CoverStatusBadge, SourceBadge, TemporaryCoverBadge } from "./cover-badges";
import { SubstitutePicker } from "./substitute-picker";

/** Cover detail, actions, substitute picker and "Cover history" (never an audit log: CAPABILITY-BOUNDARIES P1). */
export function CoverSheet({ coverId, onClose, gradeNames }: { coverId: string | null; onClose: () => void; gradeNames: Map<string, string> }) {
  const cover = useCover(coverId);
  const data = cover.data;
  const classLabel = data ? sectionLabel(gradeNames.get(data.section.gradeId), data.section.name) : "";
  return (
    <Sheet open={Boolean(coverId)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b px-4 py-4 pr-12 sm:px-6">
          <SheetTitle>{data ? `Period ${data.periodNumber} · ${classLabel} · ${data.subject.name}` : "Cover"}</SheetTitle>
          <SheetDescription>{data ? `${formatDateLong(data.date)} · ${data.absentTeacher.name} is absent` : "Loading the lesson that needs cover…"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 py-5 sm:px-6">
          {cover.isPending && coverId ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading cover">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : cover.isError && !data ? (
            <ErrorState compact error={cover.error} title={isApiError(cover.error) && cover.error.isNotFound ? "This cover no longer exists" : undefined} onRetry={() => void cover.refetch()} />
          ) : data ? (
            <CoverBody cover={data} classLabel={classLabel} onClose={onClose} stale={cover.isRefetchError} onRetry={() => void cover.refetch()} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CoverBody({ cover, classLabel, onClose, stale, onRetry }: { cover: CoverDetail; classLabel: string; onClose: () => void; stale: boolean; onRetry: () => void }) {
  const live = cover.status === "OPEN" || cover.status === "ASSIGNED";
  const unassign = useUnassignCover();
  const unassigning = useRef(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  async function runUnassign() {
    if (unassigning.current || !cover.replacementTeacher) return;
    unassigning.current = true;
    try {
      await unassign.mutateAsync(cover.id);
      notifySuccess(`${cover.replacementTeacher.name} no longer covers period ${cover.periodNumber}`, "The lesson needs cover again.");
    } catch (error) {
      notifyError(error, "Couldn’t unassign the substitute");
    } finally {
      unassigning.current = false;
    }
  }

  return (
    <>
      {stale ? <StaleDataNotice onRetry={onRetry} /> : null}
      <div className="space-y-4 rounded-lg border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <CoverStatusBadge status={cover.status} />
          <SourceBadge source={cover.assignmentSource} />
          {cover.status === "ASSIGNED" && cover.temporaryUnqualified ? <TemporaryCoverBadge /> : null}
        </div>
        <DetailList
          items={[
            { label: "Date", value: formatDateLong(cover.date) },
            { label: "Period", value: `Period ${cover.periodNumber}` },
            { label: "Class", value: classLabel },
            { label: "Subject", value: cover.subject.name },
            { label: "Absent teacher", value: cover.absentTeacher.name },
            { label: "Substitute", value: cover.replacementTeacher?.name ?? (live ? "Needs cover" : "None") },
          ]}
        />
        <AttentionNote attention={cover.attention} />
        {cover.status === "CANCELLED" ? (
          <ReadOnlyNotice>This cover was cancelled{cover.cancelReason ? `: ${cover.cancelReason}` : ""}. It can’t be changed.</ReadOnlyNotice>
        ) : cover.status === "OBSOLETE" ? (
          <ReadOnlyNotice>A new timetable was published after this cover was created, so it no longer applies. The current lesson, if any, is listed on the board.</ReadOnlyNotice>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {cover.status === "ASSIGNED" && cover.replacementTeacher ? (
            <PendingButton variant="outline" size="sm" pending={unassign.isPending} onClick={() => void runUnassign()}>
              {!unassign.isPending ? <UserMinus aria-hidden /> : null}
              Unassign {cover.replacementTeacher.name}
            </PendingButton>
          ) : null}
          {live ? (
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban aria-hidden /> Cancel cover
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/operations/absences/${cover.absenceId}`}>
              View absence <ArrowUpRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      {live ? <SubstitutePicker cover={cover} /> : null}

      <CoverHistory history={cover.history} />

      <CancelCoverDialog open={cancelOpen} onOpenChange={setCancelOpen} cover={cover} onCancelled={onClose} />
    </>
  );
}

function CancelCoverDialog({ open, onOpenChange, cover, onCancelled }: { open: boolean; onOpenChange: (open: boolean) => void; cover: CoverDetail; onCancelled: () => void }) {
  const cancel = useCancelCover();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const id = useId();

  async function confirm() {
    const trimmed = reason.trim();
    if (trimmed && isReservedCancelReason(trimmed)) {
      const message = "This reason is reserved for cancellations the system makes itself. Write a different reason.";
      setLocalError(message);
      throw new Error(message);
    }
    setLocalError(null);
    try {
      await cancel.mutateAsync({ id: cover.id, reason: trimmed || undefined });
    } catch (error) {
      if (isApiError(error) && error.uncertain) notifyError(error, "Couldn’t confirm the cancellation");
      throw error;
    }
    notifySuccess(`Cover for period ${cover.periodNumber} cancelled`, `${cover.section.name} · ${cover.subject.name} no longer needs a substitute.`);
    setReason("");
    onCancelled();
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setLocalError(null);
        onOpenChange(next);
      }}
      title="Cancel this cover?"
      description={`Period ${cover.periodNumber}, ${cover.section.name} · ${cover.subject.name} on ${formatDateLong(cover.date)} will no longer need a substitute${cover.replacementTeacher ? `, and ${cover.replacementTeacher.name} will be released` : ""}. Use this when the lesson isn’t happening or is covered another way.`}
      confirmLabel="Cancel cover"
      cancelLabel="Keep cover"
      destructive
      onConfirm={confirm}
      errorRender={(error) =>
        localError ?? (isApiError(error) ? (error.fieldError("reason") ?? error.message) : "Something went wrong. Please try again.")
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor={id}>Reason (optional)</Label>
        <Textarea id={id} value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} placeholder="For example: class on a field trip" />
      </div>
    </ConfirmDialog>
  );
}

function CoverHistory({ history }: { history: CoverDetail["history"] }) {
  const id = useId();
  const items = historyNewestFirst(history);
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-sm font-semibold text-foreground">
        Cover history
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes recorded for this cover yet.</p>
      ) : (
        <ol className="space-y-0 border-l pl-4">
          {items.map((item) => (
            <li key={item.id} className="relative pb-3 last:pb-0">
              <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-muted-foreground/50" aria-hidden />
              <p className="text-sm text-foreground">{describeHistory(item)}</p>
              {item.note ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
              <p className="text-xs text-muted-foreground">
                {formatTimestamp(item.createdAt)}
                {item.actor?.name ? ` · ${item.actor.name}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
