"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel, StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, ErrorState, StaleDataNotice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useYear } from "@/features/academic-years/year-context";
import type { Feasibility, FeasibilityIssue } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useFeasibility } from "./hooks";
import { issueCodeLabel, issueLink } from "./rules";

export function ReadinessPanel() {
  const { year } = useYear();
  const query = useFeasibility(year.id);
  const report = query.data;

  return (
    <section aria-labelledby="readiness-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id="readiness-title" className="text-base font-semibold">
            Readiness
          </h2>
          <p className="text-sm text-muted-foreground">Pre-generation checks of this year’s classes, curriculum, teachers and schedule.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={cn(query.isFetching && "animate-spin")} aria-hidden /> Run checks again
        </Button>
      </div>

      {query.isPending ? (
        <CardsSkeleton count={4} />
      ) : query.isError && !report ? (
        <ErrorState error={query.error} title="Couldn’t run the readiness checks" onRetry={() => void query.refetch()} />
      ) : report ? (
        <>
          {query.isError ? <StaleDataNotice onRetry={() => void query.refetch()} /> : null}
          <ReadinessReport report={report} />
        </>
      ) : null}
    </section>
  );
}

function ReadinessReport({ report }: { report: Feasibility }) {
  const ready = report.status === "READY";
  const s = report.summary;
  const errors = report.errors;
  const warnings = report.warnings.filter((w) => w.code !== "ACADEMIC_YEAR_NOT_DRAFT");
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={ready ? "success" : "danger"}>{ready ? "Ready" : "Not ready"}</StatusBadge>
          <span className="text-sm text-muted-foreground">Checked {formatTimestamp(report.generatedAt)}</span>
        </div>
        <p className="text-sm">
          {ready
            ? "The pre-generation checks passed."
            : `${s.errorCount} blocking issue${s.errorCount === 1 ? "" : "s"} must be fixed before a timetable can be generated.`}
        </p>
        <p className="text-sm text-muted-foreground">
          READY means the pre-generation checks passed; it does not guarantee the solver will find a timetable.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sections" value={s.sections} hint={`${s.grades} grade${s.grades === 1 ? "" : "s"}`} />
        <StatCard label="Weekly slots per class" value={s.weeklySlots ?? "—"} hint={`${s.workingDays} days × ${s.periodsPerDay} periods`} />
        <StatCard label="Periods to schedule" value={s.totalDemandPeriods} hint={`${s.requirements} subject requirement${s.requirements === 1 ? "" : "s"}`} />
        <StatCard
          label="Issues"
          value={`${s.errorCount} / ${s.warningCount}`}
          hint="blocking / warnings"
          tone={s.errorCount > 0 ? "danger" : s.warningCount > 0 ? "warning" : "default"}
        />
      </div>

      <IssueGroup title="Blocking issues" issues={errors} severity="error" empty="No blocking issues." />
      <IssueGroup title="Warnings" issues={warnings} severity="warning" empty="No warnings." />

      <SectionDemand report={report} />
      <AssignedTeachers report={report} />

      {report.notChecked.length > 0 ? (
        <p className="text-xs text-muted-foreground">Not checked before generation: {report.notChecked.join("; ")}</p>
      ) : null}
    </div>
  );
}

function IssueGroup({ title, issues, severity, empty }: { title: string; issues: FeasibilityIssue[]; severity: "error" | "warning"; empty: string }) {
  const { basePath } = useYear();
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {title} <span className="font-normal text-muted-foreground">({issues.length})</span>
      </h3>
      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border bg-surface">
          {issues.map((issue, i) => {
            const link = issueLink(issue, basePath);
            return (
              <li key={`${issue.code}-${issue.entity.id ?? i}-${i}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-2.5">
                  {severity === "error" ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Blocking" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning" aria-label="Warning" />
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{issue.message}</p>
                    {issue.hint ? <p className="text-sm text-muted-foreground">{issue.hint}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {issue.entity.label} · {issueCodeLabel(issue.code)}
                    </p>
                  </div>
                </div>
                {link ? (
                  <Button asChild variant="outline" size="sm" className="shrink-0 self-start">
                    <Link href={link.href}>
                      {link.label} <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionDemand({ report }: { report: Feasibility }) {
  const rows = report.breakdown.sections;
  if (rows.length === 0) return null;
  return (
    <Collapsible className="rounded-lg border bg-surface">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        Periods per class versus weekly slots ({rows.length})
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-x-auto border-t">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Periods needed</TableHead>
              <TableHead className="text-right">Weekly slots</TableHead>
              <TableHead className="text-right">Teacher assigned</TableHead>
              <TableHead className="text-right">Auto-allocated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const over = row.weeklySlots !== null && row.demandPeriods > row.weeklySlots;
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className={cn("tabular text-right", over && "font-medium text-destructive")}>
                    {row.demandPeriods}
                    {over ? <span className="sr-only"> (more than the weekly slots)</span> : null}
                  </TableCell>
                  <TableCell className="tabular text-right">{row.weeklySlots ?? "—"}</TableCell>
                  <TableCell className="tabular text-right">{row.assignedPeriods}</TableCell>
                  <TableCell className="tabular text-right">{row.unassignedPeriods}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** P3: planned demand of explicitly assigned teachers, inside readiness only. */
function AssignedTeachers({ report }: { report: Feasibility }) {
  const rows = report.breakdown.teachers;
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-surface">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold">
        Explicitly assigned teachers: planned periods versus capacity ({rows.length})
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-x-auto border-t">
        <p className="px-4 pt-3 text-xs text-muted-foreground">Planned demand from section assignments only. Automatically allocated lessons are not included.</p>
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              <TableHead>Teacher</TableHead>
              <TableHead className="text-right">Assigned periods</TableHead>
              <TableHead className="text-right">Capacity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.name}
                  {!row.isActive ? <span className="ml-1 text-xs text-muted-foreground">(inactive)</span> : null}
                </TableCell>
                <TableCell className={cn("tabular text-right", row.assignedPeriods > row.capacity && "font-medium text-destructive")}>{row.assignedPeriods}</TableCell>
                <TableCell className="tabular text-right">{row.capacity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
