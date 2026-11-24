"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarCheck, Copy, MoreHorizontal, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/stat-card";
import { EmptyState, ErrorState, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useYear } from "@/features/academic-years/year-context";
import { VersionStatusBadge } from "@/features/academic-years/year-status-badge";
import type { VersionSummary } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/dates";
import { useVersions } from "./hooks";
import { deleteKind, publishedVersion, staleState } from "./rules";
import { CloneVersionDialog, DeleteVersionDialog } from "./version-actions";

export function StaleBadge({ version }: { version: Pick<VersionSummary, "status" | "isStale"> }) {
  const state = staleState(version);
  if (state === "not-applicable") return null;
  if (state === "stale") return <StatusBadge tone="warning">Out of date</StatusBadge>;
  if (state === "current") return <StatusBadge tone="neutral">Current</StatusBadge>;
  return <StatusBadge tone="neutral">Couldn’t check</StatusBadge>;
}

export const SOURCE_LABEL: Record<VersionSummary["solutionSource"], string> = { CP_SAT: "CP-SAT solver", BASELINE: "Baseline" };

export function VersionsPage() {
  const { year, basePath, capabilities } = useYear();
  const query = useVersions(year.id);
  const versions = query.data;
  const published = publishedVersion(versions);
  const drafts = (versions ?? []).filter((v) => v.status === "DRAFT");
  const staleDrafts = drafts.filter((v) => v.isStale === true).length;

  const [cloneTarget, setCloneTarget] = useState<VersionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VersionSummary | null>(null);

  const columns: DataColumn<VersionSummary>[] = [
    {
      id: "number",
      header: "Version",
      sortValue: (v) => v.versionNumber,
      cell: (v) => (
        <Link href={`${basePath}/timetables/${v.id}`} className="font-medium underline-offset-2 hover:underline">
          Version {v.versionNumber}
        </Link>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (v) => (
        <div className="flex flex-wrap gap-1.5">
          <VersionStatusBadge status={v.status} />
          <StaleBadge version={v} />
        </div>
      ),
    },
    { id: "created", header: "Created", sortValue: (v) => v.createdAt, cell: (v) => formatTimestamp(v.createdAt), hideOnMobile: true },
    { id: "published", header: "Published", cell: (v) => (v.publishedAt ? formatTimestamp(v.publishedAt) : "—"), hideOnMobile: true },
    { id: "source", header: "Solution", cell: (v) => SOURCE_LABEL[v.solutionSource], hideOnMobile: true },
    { id: "lessons", header: "Lessons", align: "right", cell: (v) => <span className="tabular">{v.entryCount}</span>, hideOnMobile: true },
    { id: "locked", header: "Locked", align: "right", cell: (v) => <span className="tabular">{v.lockedCount}</span>, hideOnMobile: true },
    { id: "manual", header: "Moved by hand", align: "right", cell: (v) => <span className="tabular">{v.manualEditCount}</span>, hideOnMobile: true },
    { id: "revision", header: "Revision", align: "right", cell: (v) => <span className="tabular">{v.revision}</span>, hideOnMobile: true },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (v) => {
        const del = deleteKind(v.status);
        return (
          <div className="flex justify-end gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`${basePath}/timetables/${v.id}`} aria-label={`Open version ${v.versionNumber}`}>
                Open
              </Link>
            </Button>
            {capabilities.canEditVersions ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More actions for version ${v.versionNumber}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setCloneTarget(v)}>
                    <Copy aria-hidden /> Copy to new draft
                  </DropdownMenuItem>
                  {del ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(v)}>
                      <Trash2 aria-hidden /> Delete version
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Timetables"
        description="Every timetable generated for this year. Review and adjust drafts, then publish one. Publishing replaces the currently published timetable, which becomes archived."
        actions={
          capabilities.canGenerate ? (
            <Button asChild>
              <Link href={`${basePath}/generate`}>
                <Sparkles aria-hidden /> Generate timetable
              </Link>
            </Button>
          ) : null
        }
      />

      {query.isPending ? (
        <TableSkeleton rows={4} columns={6} />
      ) : query.isError && !versions ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : versions && versions.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck className="size-5" />}
          title="No timetables yet"
          description={
            capabilities.canGenerate
              ? "Generate a timetable once the setup is ready. It is created as a draft that you can review before publishing."
              : `${year.name} has no timetables, and generation is closed because the year is no longer a draft.`
          }
          action={
            capabilities.canGenerate ? (
              <Button asChild>
                <Link href={`${basePath}/generate`}>Go to generation</Link>
              </Button>
            ) : null
          }
        />
      ) : versions ? (
        <>
          {query.isError ? <StaleDataNotice onRetry={() => void query.refetch()} /> : null}

          <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {published ? (
              <>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">Published timetable: version {published.versionNumber}</h2>
                    <VersionStatusBadge status="PUBLISHED" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {published.publishedAt ? `Published ${formatTimestamp(published.publishedAt)}. ` : null}
                    This is the timetable daily operations and cover use.
                  </p>
                </div>
                <Button asChild className="self-start sm:self-auto">
                  <Link href={`${basePath}/timetables/${published.id}`}>
                    View published timetable <ArrowRight aria-hidden />
                  </Link>
                </Button>
              </>
            ) : (
              <div className="space-y-1">
                <h2 className="text-base font-semibold">No timetable is published for this year</h2>
                <p className="text-sm text-muted-foreground">Open a draft, check it, and publish it from its page.</p>
              </div>
            )}
          </Panel>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>
              {drafts.length} draft{drafts.length === 1 ? "" : "s"}. Each year can hold a limited number of drafts; delete drafts you no longer need.
            </p>
            {staleDrafts > 0 ? (
              <p>
                {staleDrafts} draft{staleDrafts === 1 ? " is" : "s are"} out of date: the setup changed after {staleDrafts === 1 ? "it was" : "they were"} generated.
                Out-of-date drafts can’t be published; generate a new draft instead.
              </p>
            ) : null}
          </div>

          <DataTable
            data={versions}
            columns={columns}
            getRowId={(v) => v.id}
            caption="Timetable versions"
            initialSort={{ id: "number", desc: true }}
            rowClassName={(v) => (v.status === "PUBLISHED" ? "bg-success-muted/40" : undefined)}
          />
        </>
      ) : null}

      {cloneTarget ? <CloneVersionDialog version={cloneTarget} open onOpenChange={(open) => !open && setCloneTarget(null)} /> : null}
      {deleteTarget ? <DeleteVersionDialog version={deleteTarget} open onOpenChange={(open) => !open && setDeleteTarget(null)} /> : null}
    </PageBody>
  );
}
