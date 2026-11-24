"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowLeft, Ban, Pencil, RefreshCw } from "lucide-react";
import { useBreadcrumb } from "@/components/layout/breadcrumbs";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, EmptyState, ErrorState, PageSkeleton, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/errors";
import type { AllocationSummary, AutoRun } from "@/lib/api/schemas";
import { formatDateRange, formatDateShort } from "@/lib/dates";
import { notifyError, notifySuccess } from "@/lib/notify";
import { absenceScopeLabel, boardHref } from "../board-rules";
import { useAbsence, useAbsenceAutoAssign, useAbsenceSummary, useTeachers } from "../hooks";
import { AbsenceFormSheet } from "./absence-form-sheet";
import { AutoRunFacts } from "./allocation-notice";
import { CancelAbsenceDialog } from "./cancel-absence-dialog";
import { AttentionNote, CoverStatusBadge, SourceBadge, TemporaryCoverBadge } from "./cover-badges";

type SummaryCover = AllocationSummary["covers"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AbsenceDetailPage({ absenceId }: { absenceId: string }) {
  if (!UUID.test(absenceId)) {
    return (
      <PageBody>
        <ErrorState title="Absence not found" message="The link is wrong, or the absence belongs to another school." />
      </PageBody>
    );
  }
  return <AbsenceDetail absenceId={absenceId} />;
}

function AbsenceDetail({ absenceId }: { absenceId: string }) {
  const pathname = usePathname();
  const absence = useAbsence(absenceId);
  const summary = useAbsenceSummary(absenceId);
  const teachers = useTeachers();
  const retry = useAbsenceAutoAssign();
  const inFlight = useRef(false);
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryRun, setRetryRun] = useState<AutoRun | null>(null);

  const data = absence.data;
  const name = data ? (data.teacher?.name ?? teachers.data?.find((t) => t.id === data.teacherId)?.name ?? "Teacher") : undefined;
  useBreadcrumb(pathname, name ? `${name}’s absence` : null);

  async function runRetry() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await retry.mutateAsync({ id: absenceId });
      setRetryRun(result.run);
      notifySuccess("Automatic assignment finished", `${result.run.assigned} assigned, ${result.run.unfilled} still need cover.`);
    } catch (error) {
      notifyError(error, "Automatic assignment didn’t run");
    } finally {
      inFlight.current = false;
    }
  }

  if (absence.isPending) return <PageSkeleton />;
  if (absence.isError && !data) {
    return (
      <PageBody>
        <ErrorState error={absence.error} title={isApiError(absence.error) && absence.error.isNotFound ? "Absence not found" : "Couldn’t load this absence"} onRetry={() => void absence.refetch()} />
      </PageBody>
    );
  }
  if (!data) return null;
  const active = data.status === "ACTIVE";

  const columns: DataColumn<SummaryCover>[] = [
    { id: "date", header: "Date", cell: (c) => <span className="whitespace-nowrap">{formatDateShort(c.date)}</span>, sortValue: (c) => `${c.date}-${String(c.periodNumber).padStart(2, "0")}` },
    { id: "period", header: "Period", cell: (c) => <span className="tabular">P{c.periodNumber}</span>, sortValue: (c) => c.periodNumber },
    {
      id: "lesson",
      header: "Lesson",
      cell: (c) => (
        <div>
          <p className="font-medium text-foreground">{c.section.name}</p>
          <p className="text-xs text-muted-foreground">{c.subject.name}</p>
        </div>
      ),
    },
    {
      id: "substitute",
      header: "Substitute",
      cell: (c) => (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {c.replacementTeacher ? <span className="text-foreground">{c.replacementTeacher.name}</span> : <CoverStatusBadge status={c.status} />}
            {c.status === "ASSIGNED" ? <SourceBadge source={c.assignmentSource} /> : null}
            {c.status === "ASSIGNED" && c.temporaryUnqualified ? <TemporaryCoverBadge /> : null}
          </div>
          <AttentionNote attention={c.attention} />
        </div>
      ),
    },
    {
      id: "open",
      header: <span className="sr-only">Open</span>,
      align: "right",
      cell: (c) => (
        <Button variant="outline" size="sm" asChild>
          <Link href={boardHref(c.date, c.id)} aria-label={`Open period ${c.periodNumber} on ${formatDateShort(c.date)} in daily cover`}>
            Open in daily cover
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <PageBody>
      <Button variant="ghost" size="sm" className="-ml-2 self-start" asChild>
        <Link href="/operations/absences">
          <ArrowLeft aria-hidden /> Absences
        </Link>
      </Button>
      <PageHeader
        title={`${name}’s absence`}
        eyebrow={active ? <StatusBadge tone="info">Active</StatusBadge> : <StatusBadge tone="neutral">Cancelled</StatusBadge>}
        description={`${formatDateRange(data.startDate, data.endDate)} · ${absenceScopeLabel(data)}${data.reason ? ` · ${data.reason}` : ""}`}
        actions={
          active ? (
            <>
              <PendingButton variant="outline" pending={retry.isPending} onClick={() => void runRetry()}>
                {!retry.isPending ? <RefreshCw aria-hidden /> : null}
                Try automatic assignment again
              </PendingButton>
              <Button variant="outline" onClick={() => setEditOpen(true)} disabled={!teachers.data}>
                <Pencil aria-hidden /> Edit absence
              </Button>
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban aria-hidden /> Cancel absence
              </Button>
            </>
          ) : null
        }
      />
      {absence.isRefetchError ? <StaleDataNotice onRetry={() => void absence.refetch()} /> : null}
      {retryRun ? (
        <div role="status" className="space-y-2 rounded-lg border bg-surface p-4 text-sm">
          <p className="font-medium text-foreground">Automatic assignment ran again.</p>
          <AutoRunFacts run={retryRun} />
        </div>
      ) : null}

      {summary.isPending ? (
        <>
          <CardsSkeleton count={4} />
          <TableSkeleton rows={3} columns={5} />
        </>
      ) : summary.isError && !summary.data ? (
        <ErrorState error={summary.error} title="Couldn’t load the lessons for this absence" onRetry={() => void summary.refetch()} />
      ) : (
        <>
          {summary.isRefetchError ? <StaleDataNotice onRetry={() => void summary.refetch()} /> : null}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Affected lessons" value={summary.data.totalAffectedLessons} />
            <StatCard
              label="Assigned"
              value={summary.data.assigned}
              tone={summary.data.assigned > 0 ? "success" : "default"}
              hint={`${summary.data.automaticallyAssigned} automatic · ${summary.data.manuallyAssigned} manual`}
            />
            <StatCard label="Still need cover" value={summary.data.unfilled} tone={summary.data.unfilled > 0 ? "warning" : "default"} hint={summary.data.skippedPastDates > 0 ? `${summary.data.skippedPastDates} on past dates` : undefined} />
            <StatCard
              label="Need attention"
              value={summary.data.needsAdminAttention}
              tone={summary.data.needsAdminAttention > 0 ? "warning" : "default"}
              hint={summary.data.temporaryUnqualifiedCovers > 0 ? `${summary.data.temporaryUnqualifiedCovers} temporary (unqualified) cover` : undefined}
            />
          </div>
          <Section title="Lessons needing cover" id="absence-covers">
            {summary.data.covers.length === 0 ? (
              <EmptyState
                compact
                title="No lessons need cover"
                description={active ? "The published timetable has no lessons for this teacher in this absence, or the dates have no published timetable." : "This absence was cancelled."}
              />
            ) : (
              <DataTable data={summary.data.covers} columns={columns} getRowId={(c) => c.id} caption="Lessons needing cover for this absence" initialSort={{ id: "date" }} dense />
            )}
          </Section>
        </>
      )}

      <AbsenceFormSheet open={editOpen} onOpenChange={setEditOpen} absence={data} teachers={teachers.data ?? []} />
      <CancelAbsenceDialog absence={cancelOpen ? data : null} teacherName={name ?? ""} onOpenChange={setCancelOpen} />
    </PageBody>
  );
}
