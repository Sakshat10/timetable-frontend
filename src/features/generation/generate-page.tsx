"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/stat-card";
import { EmptyState, ErrorState, ReadOnlyNotice, TableSkeleton } from "@/components/shared/states";
import { useYear } from "@/features/academic-years/year-context";
import { generationApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { GenerationRun } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/dates";
import { notifyInfo } from "@/lib/notify";
import { qk } from "@/lib/query/keys";
import { useFeasibility, useRun, useRuns, useYearVersions } from "./hooks";
import { ReadinessPanel } from "./readiness-panel";
import { activeRunId, failureGuidance, generateGate, isActiveStatus, pickAdoptableRun, readRunResult } from "./rules";
import { RunStatusBadge, RunStatusPanel } from "./run-status";

const FRESH = "fresh";

interface StartProblem {
  title: string;
  body: ReactNode;
}

export function GeneratePage() {
  const { year, basePath, capabilities } = useYear();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const runId = search.get("run");
  const sourceParam = search.get("source");

  const feasibility = useFeasibility(year.id);
  const run = useRun(runId);
  const runActive = run.data ? isActiveStatus(run.data.status) : false;
  const runs = useRuns(year.id, runActive);
  const versions = useYearVersions(year.id);
  const drafts = (versions.data ?? []).filter((v) => v.status === "DRAFT");

  const [source, setSource] = useState<string>(sourceParam ?? FRESH);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  /** Seconds left before a refused (503) start may be tried again. */
  const [retryLeft, setRetryLeft] = useState(0);

  const setRunInUrl = (id: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (id) params.set("run", id);
    else params.delete("run");
    params.delete("source");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Page load without ?run=: resume an active run of the year (§4.4).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || runId || !runs.data) return;
    resumed.current = true;
    const active = activeRunId(runs.data);
    if (active) setRunInUrl(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs.data, runId]);

  // When the followed run settles: refresh the runs list and the versions (a new draft may exist).
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = run.data?.status ?? null;
    if (lastStatus.current && lastStatus.current !== status && (status === "SUCCEEDED" || status === "FAILED")) {
      void queryClient.invalidateQueries({ queryKey: qk.runs(year.id) });
      void queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
    }
    lastStatus.current = status;
  }, [run.data?.status, queryClient, year.id]);

  // Retry-After countdown for 503s.
  const counting = retryLeft > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setRetryLeft((n) => Math.max(0, n - 1)), 1_000);
    return () => window.clearInterval(id);
  }, [counting]);

  const listActive = activeRunId(runs.data) !== null;
  const gate = generateGate({ year, report: feasibility.data, reportFailed: feasibility.isError, runActive: runActive || listActive });
  const canStart = gate.allowed && retryLeft === 0;
  const sourceDraft = drafts.find((d) => d.id === source) ?? null;

  async function adoptFromList(knownBefore: Set<string>): Promise<boolean> {
    const list = await queryClient.fetchQuery({ queryKey: qk.runs(year.id), queryFn: () => generationApi.list(year.id, 10), staleTime: 0 });
    const adopt = pickAdoptableRun(list, knownBefore);
    if (adopt) setRunInUrl(adopt);
    return adopt !== null;
  }

  async function start() {
    setProblem(null);
    const knownBefore = new Set((runs.data ?? []).map((r) => r.id));
    const options = sourceDraft ? { sourceVersionId: sourceDraft.id } : undefined;
    try {
      const accepted = await generationApi.start({ academicYearId: year.id, ...(options ? { options } : {}) });
      setRunInUrl(accepted.generationRunId);
      void queryClient.invalidateQueries({ queryKey: qk.runs(year.id) });
    } catch (error) {
      if (!isApiError(error)) throw error;
      // Lost response: NEVER re-POST. Find the run in the list (§4.4).
      if (error.uncertain) {
        const adopted = await adoptFromList(knownBefore).catch(() => false);
        if (adopted) notifyInfo("The server’s answer was lost", "The run it started has been found and is shown below.");
        else
          setProblem({
            title: "We couldn’t confirm whether generation started",
            body: "The server’s answer was lost. Check Recent runs below before trying again; starting again could create a second draft.",
          });
        return;
      }
      if (error.status === 409 && "existingRunId" in error.details) {
        const existing = error.details.existingRunId;
        if (typeof existing === "string") setRunInUrl(existing);
        else await adoptFromList(new Set()).catch(() => false);
        notifyInfo("A run is already in progress for this year", "It is shown below.");
        return;
      }
      if (error.code === "DRAFT_LIMIT_REACHED") {
        const max = typeof error.details.maxDraftsPerYear === "number" ? error.details.maxDraftsPerYear : null;
        setProblem({
          title: "This year has reached its limit of draft timetables",
          body: (
            <>
              {max !== null ? `A year can hold at most ${max} drafts. ` : null}Delete drafts you no longer need, or publish one, then generate again.{" "}
              <Link href={`${basePath}/timetables`} className="font-medium underline underline-offset-2">
                Manage drafts
              </Link>
            </>
          ),
        });
        return;
      }
      if (error.code === "NOT_READY" || error.details.status === "NOT_READY") {
        void feasibility.refetch();
        const issues = Array.isArray(error.details.issues) ? (error.details.issues as Array<{ code?: string; message?: string }>) : [];
        setProblem({
          title: "The year is not ready for generation",
          body: (
            <>
              The setup changed since the checks last ran. The readiness report has been refreshed.
              {issues.length > 0 ? <IssueList issues={issues} /> : null}
            </>
          ),
        });
        return;
      }
      if (error.code === "LOCKS_INVALID") {
        const issues = Array.isArray(error.details.issues) ? (error.details.issues as Array<{ code?: string; message?: string }>) : [];
        setProblem({
          title: "The locked lessons of the source draft don’t fit the current setup",
          body: (
            <>
              Unlock these lessons in the source draft, or generate a fresh timetable instead.
              <IssueList issues={issues} />
            </>
          ),
        });
        return;
      }
      if (error.code?.startsWith("SOURCE_VERSION_")) {
        void queryClient.invalidateQueries({ queryKey: qk.versions(year.id) });
        setSource(FRESH);
        setProblem({ title: "That source draft can’t be used", body: `${error.message}. Choose another draft or generate a fresh timetable.` });
        return;
      }
      if (error.status === 503) {
        const ms = error.retryAfterMs ?? (error.code === "BUSY" ? 2_000 : 30_000);
        setRetryLeft(Math.ceil(ms / 1000));
        setProblem({
          title: error.code === "BUSY" ? "The year is being changed by another operation" : "The generation queue is full",
          body: `Nothing was started. You can try again in ${Math.ceil(ms / 1000)} seconds.`,
        });
        return;
      }
      if (error.status === 400) {
        void queryClient.invalidateQueries({ queryKey: qk.year(year.id) });
        setProblem({ title: "Generation was refused", body: error.message });
        return;
      }
      setProblem({ title: "Generation could not be started", body: error.message });
    }
  }

  const followed = run.data;

  return (
    <PageBody>
      <PageHeader
        title="Generate timetable"
        description="Check that the setup is ready, then generate a new draft timetable. Generating never changes or publishes an existing timetable."
      />

      {year.status !== "DRAFT" ? (
        <ReadOnlyNotice>
          <p className="font-medium text-foreground">Generation is closed for this year</p>
          <p>
            {year.name} is {year.status === "ACTIVE" ? "active" : "completed"}. Activating a year ends timetable generation, because its setup is locked.
            {capabilities.canEditVersions ? (
              <>
                {" "}
                You can still copy an existing version to a new draft and adjust it by hand on the{" "}
                <Link href={`${basePath}/timetables`} className="font-medium underline underline-offset-2">
                  Timetables
                </Link>{" "}
                page.
              </>
            ) : null}
          </p>
        </ReadOnlyNotice>
      ) : null}

      {runId && run.isError ? (
        <ErrorState compact error={run.error} title="Couldn’t load this generation run" onRetry={() => void run.refetch()} />
      ) : followed ? (
        <RunStatusPanel
          run={followed}
          onRecheck={() => void feasibility.refetch()}
          onGenerateAgain={() => setConfirmOpen(true)}
          canGenerateAgain={canStart}
        />
      ) : null}

      {year.status === "DRAFT" ? (
        <Panel className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">New draft</h2>
            <p className="text-sm text-muted-foreground">
              Generation runs on the server and usually takes from a few seconds to a few minutes. It creates a new draft version; you review and publish it separately.
            </p>
          </div>
          {drafts.length > 0 ? (
            <div className="flex max-w-xl flex-col gap-1.5">
              <Label htmlFor="generate-source">Start from</Label>
              <Select value={sourceDraft ? source : FRESH} onValueChange={setSource}>
                <SelectTrigger id="generate-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FRESH}>A fresh timetable</SelectItem>
                  {drafts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      Draft version {d.versionNumber}, keeping its {d.lockedCount} locked lesson{d.lockedCount === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Regenerating from a draft keeps that draft’s locked lessons exactly where they are and arranges everything else again. The source draft itself is not changed.
              </p>
              {sourceDraft && sourceDraft.lockedCount === 0 ? (
                <p className="text-xs text-warning-foreground dark:text-warning">This draft has no locked lessons, so the result is the same as a fresh timetable.</p>
              ) : null}
            </div>
          ) : null}

          {problem ? (
            <div role="alert" className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2.5 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium text-destructive">{problem.title}</p>
                <div className="text-foreground">{problem.body}</div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setConfirmOpen(true)} disabled={!canStart}>
              <Sparkles aria-hidden /> {sourceDraft ? "Regenerate keeping locked lessons" : "Generate timetable"}
            </Button>
            {!gate.allowed ? <span className="text-sm text-muted-foreground">{gate.message}</span> : null}
            {gate.allowed && retryLeft > 0 ? <span className="text-sm text-muted-foreground">You can try again in {retryLeft} s.</span> : null}
          </div>
        </Panel>
      ) : null}

      <ReadinessPanel />

      <RecentRuns runs={runs.data} isPending={runs.isPending} error={runs.isError ? runs.error : null} onRetry={() => void runs.refetch()} selectedId={runId} onSelect={setRunInUrl} />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={sourceDraft ? `Regenerate from draft version ${sourceDraft.versionNumber}?` : "Generate a new draft timetable?"}
        description={
          <>
            A new draft version of {year.name} will be created. Nothing is published and no existing version is changed.
            {sourceDraft ? ` Its ${sourceDraft.lockedCount} locked lesson${sourceDraft.lockedCount === 1 ? "" : "s"} stay where they are.` : null}
          </>
        }
        confirmLabel={sourceDraft ? "Regenerate" : "Generate"}
        onConfirm={start}
      >
        <p className="text-muted-foreground">Once started, a run continues to the end on the server. You can leave the page and come back to it.</p>
      </ConfirmDialog>
    </PageBody>
  );
}

function IssueList({ issues }: { issues: Array<{ code?: string; message?: string }> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
      {issues.slice(0, 20).map((issue, i) => (
        <li key={`${issue.code}-${i}`}>{issue.message ?? issue.code}</li>
      ))}
    </ul>
  );
}

function RecentRuns({
  runs,
  isPending,
  error,
  onRetry,
  selectedId,
  onSelect,
}: {
  runs: GenerationRun[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { basePath } = useYear();
  return (
    <section aria-labelledby="runs-title" className="flex flex-col gap-3">
      <h2 id="runs-title" className="text-base font-semibold">
        Recent runs
      </h2>
      {isPending ? (
        <TableSkeleton rows={3} columns={4} />
      ) : error && !runs ? (
        <ErrorState compact error={error} onRetry={onRetry} />
      ) : !runs || runs.length === 0 ? (
        <EmptyState compact title="No timetable has been generated for this year yet" />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => {
                const result = readRunResult(r.result);
                return (
                  <TableRow key={r.id} className={r.id === selectedId ? "bg-accent/50" : undefined}>
                    <TableCell className="whitespace-nowrap">{formatTimestamp(r.createdAt)}</TableCell>
                    <TableCell>
                      <RunStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.status === "SUCCEEDED" ? (
                        r.versionId ? (
                          <Link href={`${basePath}/timetables/${r.versionId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                            Draft version {result.versionNumber ?? ""}
                          </Link>
                        ) : (
                          "Draft deleted"
                        )
                      ) : r.status === "FAILED" ? (
                        failureGuidance(r.failure?.code).title
                      ) : (
                        "In progress"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => onSelect(r.id)} aria-label={`Show run started ${formatTimestamp(r.createdAt)}`} disabled={r.id === selectedId}>
                        {r.id === selectedId ? "Shown" : "Show"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
