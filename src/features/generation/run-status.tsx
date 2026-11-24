"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleAlert, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import { DetailList, Panel } from "@/components/shared/stat-card";
import { useYear } from "@/features/academic-years/year-context";
import type { GenerationRun, RunStatus } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/dates";
import { RUN_STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { failureGuidance, formatDuration, isActiveStatus, PHASES, readRunResult, resultWarningText, secondsBetween, SOLUTION_SOURCE_LABEL, stepStates } from "./rules";

const RUN_TONE: Record<RunStatus, Tone> = { QUEUED: "neutral", RUNNING: "info", SUCCEEDED: "success", FAILED: "danger" };

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return <StatusBadge tone={RUN_TONE[status]}>{RUN_STATUS_LABEL[status]}</StatusBadge>;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/** X1/X2: a phase stepper and elapsed time against the server's budget. No percentage, no cancel. */
export function RunStatusPanel({
  run,
  onRecheck,
  onGenerateAgain,
  canGenerateAgain,
}: {
  run: GenerationRun;
  onRecheck: () => void;
  onGenerateAgain: () => void;
  canGenerateAgain: boolean;
}) {
  const active = isActiveStatus(run.status);
  const now = useNow(active);
  const states = stepStates(run);
  const elapsed = run.startedAt
    ? run.completedAt
      ? secondsBetween(run.startedAt, new Date(run.completedAt).getTime())
      : secondsBetween(run.startedAt, now)
    : null;
  const waiting = run.status === "QUEUED" ? secondsBetween(run.createdAt, now) : null;

  return (
    <Panel className="flex flex-col gap-4">
      <div aria-live="polite" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Generation run</h2>
          <RunStatusBadge status={run.status} />
          {run.sourceVersionId ? (
            <span className="text-xs text-muted-foreground">
              keeping {run.lockedEntryCount} locked lesson{run.lockedEntryCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">Started {formatTimestamp(run.createdAt)}</span>
      </div>

      <ol aria-label="Generation phases" className="flex flex-wrap gap-x-1 gap-y-2">
        {PHASES.map((step, i) => {
          const state = states[i];
          return (
            <li
              key={step.label}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                state === "complete" && "border-success/30 bg-success-muted text-success",
                state === "current" && "border-primary/40 bg-accent font-medium text-accent-foreground",
                state === "failed" && "border-destructive/30 bg-destructive-muted font-medium text-destructive",
                state === "pending" && "text-muted-foreground",
              )}
            >
              {state === "complete" ? <Check className="size-3" aria-hidden /> : null}
              {state === "current" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {state === "failed" ? <X className="size-3" aria-hidden /> : null}
              {step.label}
              <span className="sr-only">
                {state === "complete" ? " (done)" : state === "current" ? " (in progress)" : state === "failed" ? " (failed here)" : " (not started)"}
              </span>
            </li>
          );
        })}
      </ol>
      {run.phase && !PHASES.some((p) => p.phase === run.phase) ? <p className="text-xs text-muted-foreground">Current phase: {run.phase}</p> : null}

      <p className="text-sm text-muted-foreground">
        {waiting !== null ? (
          <>Waiting in the queue for {formatDuration(waiting)}. </>
        ) : elapsed !== null ? (
          <>
            {active ? "Elapsed" : "Took"} <span className="tabular font-medium text-foreground">{formatDuration(elapsed)}</span>.{" "}
          </>
        ) : null}
        Solver time budget: <span className="tabular">{formatDuration(run.timeLimitSeconds)}</span> (a server limit, not an estimate of when it will finish).
        {active ? " You can leave this page; the run continues and can be followed again from Recent runs." : null}
      </p>

      {run.status === "SUCCEEDED" ? <RunSucceeded run={run} /> : null}
      {run.status === "FAILED" ? <RunFailed run={run} onRecheck={onRecheck} onGenerateAgain={onGenerateAgain} canGenerateAgain={canGenerateAgain} /> : null}
      </div>
    </Panel>
  );
}

function RunSucceeded({ run }: { run: GenerationRun }) {
  const { basePath } = useYear();
  const result = readRunResult(run.result);
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-sm font-medium">
        {result.versionNumber !== null ? `Draft version ${result.versionNumber} was created.` : "A new draft version was created."} Nothing has been published.
      </p>
      <DetailList
        items={[
          { label: "Solution", value: result.solutionSource ? SOLUTION_SOURCE_LABEL[result.solutionSource] : "—" },
          { label: "Lessons", value: result.entryCount ?? "—" },
        ]}
      />
      {result.warnings.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
          {result.warnings.map((w) => (
            <li key={w}>{resultWarningText(w)}</li>
          ))}
        </ul>
      ) : null}
      {run.versionDeleted ? (
        <p className="text-sm text-muted-foreground">The draft created by this run has since been deleted.</p>
      ) : run.versionId ? (
        <div>
          <Button asChild>
            <Link href={`${basePath}/timetables/${run.versionId}`}>
              Open the new draft <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunFailed({ run, onRecheck, onGenerateAgain, canGenerateAgain }: { run: GenerationRun; onRecheck: () => void; onGenerateAgain: () => void; canGenerateAgain: boolean }) {
  const { basePath } = useYear();
  const code = run.failure?.code ?? null;
  const g = failureGuidance(code);
  return (
    <div role="alert" className="flex flex-col gap-3 border-t pt-4">
      <div className="flex gap-2.5">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">{g.title}</p>
          <p className="text-sm text-muted-foreground">{g.description}</p>
          {run.failure?.message ? <p className="text-xs text-muted-foreground">Server message: {run.failure.message}</p> : null}
          {g.showCode && code ? <p className="text-xs text-muted-foreground">Code: {code}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {g.action === "recheck" || g.action === "review-setup" ? (
          <Button variant="outline" size="sm" onClick={onRecheck}>
            <RefreshCw aria-hidden /> Run checks again
          </Button>
        ) : null}
        {g.action === "manage-drafts" ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/timetables`}>Manage drafts</Link>
          </Button>
        ) : null}
        {g.action === "adjust-locks" && run.sourceVersionId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`${basePath}/timetables/${run.sourceVersionId}?mode=edit`}>Open the source draft</Link>
          </Button>
        ) : null}
        <Button size="sm" onClick={onGenerateAgain} disabled={!canGenerateAgain}>
          Generate again
        </Button>
      </div>
    </div>
  );
}
