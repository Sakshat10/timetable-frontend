"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpen, CalendarCheck2, CalendarRange, GraduationCap, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Panel, StatCard } from "@/components/shared/stat-card";
import { EmptyState, ErrorState, ReadOnlyNotice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useYear } from "@/features/academic-years/year-context";
import { VersionStatusBadge, YearStatusBadge } from "@/features/academic-years/year-status-badge";
import { completion, computeSetupSteps, nextStep } from "@/features/setup-guide/progress";
import { StepIcon } from "@/features/setup-guide/step-icon";
import { useSetupData } from "@/features/setup-guide/use-setup-data";
import { coversApi, generationApi } from "@/lib/api/endpoints";
import { formatDateLong, formatRelative, todayUtc } from "@/lib/dates";
import { RUN_STATUS_LABEL, plural } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { CurriculumLoadChart } from "./curriculum-load-chart";

function CardShell({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Panel>
  );
}

/** Administrative overview of the selected year. Every number comes from a backend read; each card fails on its own. */
export function DashboardPage() {
  const { year, basePath, capabilities } = useYear();
  const data = useSetupData(year.id);
  const today = todayUtc();
  const runs = useQuery({ queryKey: [...qk.runs(year.id), "recent"], queryFn: () => generationApi.list(year.id, 5) });
  const covers = useQuery({
    queryKey: qk.covers({ date: today, scope: "dashboard" }),
    queryFn: () => coversApi.list({ from: today, to: today, status: ["OPEN", "ASSIGNED"], limit: 500 }),
    staleTime: 60_000,
  });

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

  const curriculum = data.curriculum.data;
  const sections = curriculum?.grades.reduce((n, g) => n + g.sectionCount, 0);
  const activeTeachers = data.teachers.data?.filter((t) => t.isActive).length;
  const feasibility = data.feasibility.data;
  const versions = data.versions.data;
  const published = versions?.find((v) => v.status === "PUBLISHED");
  const latestDraft = versions?.filter((v) => v.status === "DRAFT").sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const latestRun = runs.data?.[0];
  const openCovers = covers.data?.items.filter((c) => c.status === "OPEN").length;
  const warnings = [
    ...(feasibility?.errors ?? []).slice(0, 4).map((issue) => ({ key: `f-${issue.code}-${issue.entity.id}`, text: `${issue.entity.label}: ${issue.message}`, href: `${basePath}/generate` })),
    ...(curriculum?.issues ?? []).slice(0, 3).map((issue, i) => ({ key: `c-${issue.code}-${i}`, text: issue.message, href: `${basePath}/curriculum` })),
  ];

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            Academic year {year.name} <YearStatusBadge status={year.status} compact />
          </span>
        }
        title="Dashboard"
        description="Setup progress, timetable status and today’s cover for this school."
        actions={
          <Button asChild variant="outline">
            <Link href={`${basePath}/setup`}>Open setup guide</Link>
          </Button>
        }
      />
      {!capabilities.canEditSetup && capabilities.setupLockedReason ? <ReadOnlyNotice>{capabilities.setupLockedReason}</ReadOnlyNotice> : null}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard
          label="Sections"
          icon={<GraduationCap />}
          href={`${basePath}/classes`}
          value={sections ?? (data.curriculum.isPending ? <Skeleton className="h-7 w-10" /> : "–")}
          hint={curriculum ? `${plural(curriculum.grades.length, "grade")}` : data.curriculum.isError ? "Couldn’t load" : undefined}
        />
        <StatCard
          label="Active teachers"
          icon={<Users />}
          href={`${basePath}/teachers`}
          value={activeTeachers ?? (data.teachers.isPending ? <Skeleton className="h-7 w-10" /> : "–")}
          hint={data.teachers.data ? `${plural(data.teachers.data.length - (activeTeachers ?? 0), "inactive teacher")}` : data.teachers.isError ? "Couldn’t load" : undefined}
        />
        <StatCard
          label="Subjects"
          icon={<BookOpen />}
          href={`${basePath}/subjects`}
          value={data.subjects.data?.length ?? (data.subjects.isPending ? <Skeleton className="h-7 w-10" /> : "–")}
          hint={curriculum ? `${curriculum.subjects.filter((s) => s.gradeCount > 0).length} used this year` : undefined}
        />
        <StatCard
          label="Readiness"
          icon={<ShieldCheck />}
          href={`${basePath}/generate`}
          tone={feasibility ? (feasibility.status === "READY" ? "success" : "warning") : "default"}
          value={feasibility ? (feasibility.status === "READY" ? "Ready" : "Not ready") : data.feasibility.isPending ? <Skeleton className="h-7 w-20" /> : "–"}
          hint={feasibility ? `${plural(feasibility.summary.errorCount, "blocking issue")} · ${plural(feasibility.summary.warningCount, "warning")}` : data.feasibility.isError ? "Couldn’t run the check" : undefined}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CardShell
            title="Setup progress"
            action={
              <span className="text-xs text-muted-foreground tabular">
                {data.isPending ? "Checking…" : `${done}/${total} complete`}
              </span>
            }
          >
            <ul className="space-y-2.5">
              {steps.map((step) => (
                <li key={step.id} className="flex items-center gap-3">
                  {data.isPending ? <Skeleton className="size-4 rounded-full" /> : <StepIcon state={step.state} className="size-4" />}
                  <Link href={`${basePath}${step.href}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                    {step.title}
                  </Link>
                  <span className="hidden max-w-[50%] truncate text-xs text-muted-foreground sm:block">{data.isPending ? "" : step.detail}</span>
                </li>
              ))}
            </ul>
            {next && !data.isPending ? (
              <Button asChild size="sm" className="self-start">
                <Link href={`${basePath}${next.href}`}>
                  Continue: {next.title} <ArrowRight />
                </Link>
              </Button>
            ) : null}
          </CardShell>
        </div>

        <div className="lg:col-span-2">
          <CardShell
            title="Timetable"
            action={
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-primary hover:bg-primary-soft hover:text-primary-hover">
                <Link href={`${basePath}/timetables`}>All timetables</Link>
              </Button>
            }
          >
            {data.versions.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : data.versions.isError ? (
              <ErrorState compact error={data.versions.error} onRetry={() => void data.versions.refetch()} />
            ) : !published && !latestDraft ? (
              <EmptyState
                compact
                icon={<CalendarRange className="size-5" />}
                title="No timetable yet"
                description={capabilities.canGenerate ? "Generate a draft once the readiness check passes." : "Generation is closed for this year."}
                action={
                  capabilities.canGenerate ? (
                    <Button asChild size="sm">
                      <Link href={`${basePath}/generate`}>Go to generation</Link>
                    </Button>
                  ) : null
                }
              />
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Published</dt>
                  <dd>
                    {published ? (
                      <Link href={`${basePath}/timetables/${published.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                        Version {published.versionNumber} <VersionStatusBadge status="PUBLISHED" />
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Latest draft</dt>
                  <dd>
                    {latestDraft ? (
                      <Link href={`${basePath}/timetables/${latestDraft.id}`} className="inline-flex items-center gap-2 font-medium hover:underline">
                        Version {latestDraft.versionNumber}
                        {latestDraft.isStale === true ? <StatusBadge tone="warning">Out of date</StatusBadge> : latestDraft.isStale === false ? <StatusBadge tone="success">Current</StatusBadge> : null}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Last generation</dt>
                  <dd className="text-right">
                    {runs.isPending ? (
                      <Skeleton className="h-4 w-24" />
                    ) : latestRun ? (
                      <Link href={`${basePath}/generate?run=${latestRun.id}`} className="hover:underline">
                        {RUN_STATUS_LABEL[latestRun.status]} · {formatRelative(latestRun.createdAt)}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{runs.isError ? "Couldn’t load" : "Never"}</span>
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </CardShell>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CardShell title="Curriculum load by grade">
            {data.curriculum.isPending ? (
              <Skeleton className="h-56 w-full" />
            ) : data.curriculum.isError ? (
              <ErrorState compact error={data.curriculum.error} onRetry={() => void data.curriculum.refetch()} />
            ) : curriculum && curriculum.grades.some((g) => g.curricula.length > 0) ? (
              <CurriculumLoadChart curriculum={curriculum} />
            ) : (
              <EmptyState compact title="No curriculum yet" description="Add classes and subject requirements to see weekly load per grade." />
            )}
          </CardShell>
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2">
          <CardShell
            title="Today’s cover"
            action={
              <Button asChild variant="ghost" size="sm" className="-mr-2 text-primary hover:bg-primary-soft hover:text-primary-hover">
                <Link href="/operations">Daily cover</Link>
              </Button>
            }
          >
            <p className="-mt-2 text-xs text-muted-foreground">{formatDateLong(today)} (server calendar, UTC)</p>
            {covers.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : covers.isError ? (
              <ErrorState compact error={covers.error} onRetry={() => void covers.refetch()} />
            ) : covers.data.total === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarCheck2 className="size-4" aria-hidden /> No lessons need cover today.
              </p>
            ) : (
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-2xl font-semibold tabular">{covers.data.total}</p>
                  <p className="text-xs text-muted-foreground">lessons need cover</p>
                </div>
                <div>
                  <p className={`text-2xl font-semibold tabular ${openCovers ? "text-warning-foreground" : ""}`}>{openCovers}</p>
                  <p className="text-xs text-muted-foreground">without a substitute</p>
                </div>
              </div>
            )}
          </CardShell>
          <CardShell title="Needs attention">
            {data.feasibility.isPending || data.curriculum.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : data.feasibility.isError || data.curriculum.isError ? (
              <p className="text-sm text-muted-foreground">Some checks could not be loaded, so this list may be incomplete.</p>
            ) : warnings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No blocking readiness issues or curriculum problems.</p>
            ) : (
              <ul className="space-y-2">
                {warnings.map((warning) => (
                  <li key={warning.key} className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <Link href={warning.href} className="hover:underline">
                      {warning.text}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardShell>
        </div>
      </div>
    </PageBody>
  );
}
