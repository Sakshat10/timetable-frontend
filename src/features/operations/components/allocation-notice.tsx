"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { PendingButton } from "@/components/shared/confirm-dialog";
import type { AutoRun, CreateAbsenceResult } from "@/lib/api/schemas";
import { errorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { autoRunFacts } from "../board-rules";
import { useAbsenceAutoAssign } from "../hooks";

type AutomaticAllocation = CreateAbsenceResult["automaticAllocation"];

/** The six counts of an automatic assignment run, as the backend returned them. */
export function AutoRunFacts({ run, className }: { run: AutoRun; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3", className)}>
      {autoRunFacts(run).map((fact) => (
        <div key={fact.label} className="space-y-0.5">
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="tabular text-sm font-semibold text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function NoticeRow({ tone, children }: { tone: "info" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  return (
    <div className="flex items-start gap-2">
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "success" && "text-success",
          tone === "info" && "text-info",
          tone === "warning" && "text-warning-foreground",
          tone === "danger" && "text-destructive",
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

export interface AllocationNoticeProps {
  coverRequestsCreated?: number;
  coverRequestsCancelled?: number;
  coverRequestsReopened?: number;
  datesWithoutPublishedTimetable?: number;
  ambiguousDates?: string[];
  automaticAllocation?: AutomaticAllocation | null;
  /** Enables "Try automatic assignment again" for a FAILED run. */
  absenceId?: string;
  className?: string;
}

/** What happened after recording or changing an absence (PHASE-0-AUDIT §6.1): covers created and the automatic run. */
export function AllocationNotice({
  coverRequestsCreated,
  coverRequestsCancelled,
  coverRequestsReopened,
  datesWithoutPublishedTimetable,
  ambiguousDates,
  automaticAllocation,
  absenceId,
  className,
}: AllocationNoticeProps) {
  const retry = useAbsenceAutoAssign();
  const inFlight = useRef(false);
  const [retryRun, setRetryRun] = useState<AutoRun | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function runRetry() {
    if (!absenceId || inFlight.current) return;
    inFlight.current = true;
    setRetryError(null);
    try {
      const result = await retry.mutateAsync({ id: absenceId, allowTemporaryCover: automaticAllocation?.allowTemporaryCover });
      setRetryRun(result.run);
    } catch (error) {
      setRetryError(errorMessage(error));
      notifyError(error, "Automatic assignment didn’t run");
    } finally {
      inFlight.current = false;
    }
  }

  const changes: string[] = [];
  if (coverRequestsCreated !== undefined) changes.push(`${plural(coverRequestsCreated, "lesson")} now need${coverRequestsCreated === 1 ? "s" : ""} cover`);
  if (coverRequestsReopened) changes.push(`${plural(coverRequestsReopened, "lesson")} reopened`);
  if (coverRequestsCancelled) changes.push(`${plural(coverRequestsCancelled, "lesson")} no longer need${coverRequestsCancelled === 1 ? "s" : ""} cover`);

  return (
    <div role="status" className={cn("space-y-3 rounded-lg border bg-surface p-4 text-sm", className)}>
      {changes.length > 0 ? (
        <NoticeRow tone="info">
          <p className="font-medium text-foreground">{changes.join(" · ")}.</p>
        </NoticeRow>
      ) : null}
      {datesWithoutPublishedTimetable ? (
        <NoticeRow tone="warning">
          <p>
            {plural(datesWithoutPublishedTimetable, "date")} had no published timetable, so no cover was created for{" "}
            {datesWithoutPublishedTimetable === 1 ? "it" : "them"}.
          </p>
        </NoticeRow>
      ) : null}
      {ambiguousDates && ambiguousDates.length > 0 ? (
        <NoticeRow tone="warning">
          <p>
            These dates fall inside two academic years, so no cover was created for them: {ambiguousDates.map((d) => formatDate(d)).join(", ")}.
          </p>
        </NoticeRow>
      ) : null}
      {automaticAllocation ? (
        retryRun ? (
          <NoticeRow tone="success">
            <p className="font-medium text-foreground">Automatic assignment ran again.</p>
            <AutoRunFacts run={retryRun} />
          </NoticeRow>
        ) : automaticAllocation.status === "COMPLETED" ? (
          <NoticeRow tone="success">
            <p className="font-medium text-foreground">Substitutes were assigned automatically where possible.</p>
            {automaticAllocation.run ? <AutoRunFacts run={automaticAllocation.run} /> : null}
            {automaticAllocation.releasedAutomaticAssignments > 0 ? (
              <p className="text-muted-foreground">
                {plural(automaticAllocation.releasedAutomaticAssignments, "automatic assignment")} of this teacher as a substitute{" "}
                {automaticAllocation.releasedAutomaticAssignments === 1 ? "was" : "were"} released and reallocated.
              </p>
            ) : null}
          </NoticeRow>
        ) : automaticAllocation.status === "FAILED" ? (
          <NoticeRow tone="danger">
            <p className="font-medium text-foreground">The absence was saved, but automatic assignment didn’t finish.</p>
            {automaticAllocation.error ? <p className="text-muted-foreground">{automaticAllocation.error}</p> : null}
            {retryError ? <p className="text-destructive">{retryError}</p> : null}
            {absenceId ? (
              <PendingButton size="sm" variant="outline" pending={retry.isPending} onClick={() => void runRetry()}>
                {!retry.isPending ? <RefreshCw aria-hidden /> : null}
                Try automatic assignment again
              </PendingButton>
            ) : null}
          </NoticeRow>
        ) : (
          <NoticeRow tone="info">
            <p>
              Automatic assignment was off. Assign substitutes from the{" "}
              <Link href="/operations" className="font-medium text-primary underline-offset-2 hover:underline">
                daily cover board
              </Link>
              .
            </p>
          </NoticeRow>
        )
      ) : null}
    </div>
  );
}
