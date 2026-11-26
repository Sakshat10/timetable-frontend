"use client";

import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/stat-card";
import { ReadOnlyNotice, StaleDataNotice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { withSetupReturn } from "@/components/shared/setup-return-link";
import { Skeleton } from "@/components/ui/skeleton";
import { useYear } from "@/features/academic-years/year-context";
import { cn } from "@/lib/utils";
import { completion, computeSetupSteps, nextStep } from "./progress";
import { STEP_LABEL, StepIcon } from "./step-icon";
import { useSetupData } from "./use-setup-data";

/**
 * Guided setup. Progress is derived from saved backend data only; the user can leave and come back at
 * any time, and every step links to the normal management page (no separate onboarding forms or storage).
 */
export function SetupGuidePage() {
  const { year, basePath, capabilities } = useYear();
  const data = useSetupData(year.id);
  const steps = computeSetupSteps({
    yearStatus: year.status,
    schedule: data.schedule.data,
    curriculum: data.curriculum.data,
    subjects: data.subjects.data,
    teachers: data.teachers.data,
    assignments: data.assignments.data,
    feasibility: data.feasibility.data,
    versions: data.versions.data,
  });
  const { done, total } = completion(steps);
  const next = nextStep(steps);
  const feasibility = data.feasibility.data;

  return (
    <PageBody>
      <PageHeader
        eyebrow={`Academic year ${year.name}`}
        title="Setup guide"
        description="Work through these steps in order. Progress comes from what is saved; leave at any time and pick up where you stopped."
        actions={
          <Button variant="outline" onClick={() => void data.refetchAll()}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      {!capabilities.canEditSetup && capabilities.setupLockedReason ? <ReadOnlyNotice>{capabilities.setupLockedReason}</ReadOnlyNotice> : null}
      {data.failed > 0 && !data.isPending ? <StaleDataNotice onRetry={() => void data.refetchAll()} /> : null}

      <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">
            {data.isPending ? "Checking your setup…" : `${done} of ${total} steps complete`}
          </p>
          <Progress value={total ? (done / total) * 100 : 0} aria-label="Setup completion" className="h-2" />
        </div>
        {next && !data.isPending ? (
          <Button asChild>
            <Link href={withSetupReturn(`${basePath}${next.href}`)}>
              Next: {next.title} <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </Panel>

      <Section title="Steps">
        <ol className="overflow-hidden rounded-xl border bg-surface shadow-card">
          {steps.map((step, index) => (
            <li key={step.id} className={cn("flex flex-col gap-3 border-b p-4 last:border-b-0 sm:flex-row sm:items-center", step.id === next?.id && "bg-accent/30")}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
                  {data.isPending ? <Skeleton className="size-5 rounded-full" /> : <StepIcon state={step.state} />}
                </span>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="text-muted-foreground tabular">{index + 1}.</span> {step.title}
                    {!data.isPending ? (
                      <StatusBadge tone={step.state === "done" ? "success" : step.state === "attention" ? "warning" : "neutral"} dot={false} className="h-5 text-[11px]">
                        {STEP_LABEL[step.state]}
                      </StatusBadge>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                  {data.isPending ? <Skeleton className="h-3.5 w-56" /> : <p className="text-sm text-foreground">{step.detail}</p>}
                </div>
              </div>
              <Button asChild variant={step.id === next?.id ? "default" : "outline"} size="sm" className="self-start sm:self-center">
                <Link href={withSetupReturn(`${basePath}${step.href}`)}>{step.cta}</Link>
              </Button>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="Readiness review"
        description="READY means the pre-generation checks passed. It does not guarantee the solver will find a timetable."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={withSetupReturn(`${basePath}/generate`)}>Open full report</Link>
          </Button>
        }
      >
        <Panel>
          {data.feasibility.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !feasibility ? (
            <p className="text-sm text-muted-foreground">The readiness check could not be loaded.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={feasibility.status === "READY" ? "success" : "warning"}>{feasibility.status === "READY" ? "Ready" : "Not ready"}</StatusBadge>
                <span className="text-sm text-muted-foreground">
                  {feasibility.summary.errorCount} blocking · {feasibility.summary.warningCount} warnings · {feasibility.summary.sections} sections ·{" "}
                  {feasibility.summary.totalDemandPeriods} periods of demand a week
                </span>
              </div>
              {feasibility.errors.length > 0 ? (
                <ul className="space-y-1.5 text-sm">
                  {feasibility.errors.slice(0, 5).map((issue, i) => (
                    <li key={`${issue.code}-${i}`} className="flex gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
                      <span>
                        <span className="font-medium">{issue.entity.label}:</span> {issue.message}
                      </span>
                    </li>
                  ))}
                  {feasibility.errors.length > 5 ? <li className="text-muted-foreground">…and {feasibility.errors.length - 5} more in the full report.</li> : null}
                </ul>
              ) : null}
            </div>
          )}
        </Panel>
      </Section>
    </PageBody>
  );
}
