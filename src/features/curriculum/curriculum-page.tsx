"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, Copy, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { matchesQuery, SearchInput, Toolbar } from "@/components/shared/search-input";
import { CardsSkeleton, EmptyState, ErrorState, NoResults, ReadOnlyNotice, StaleDataNotice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import type { CurriculumGrade, CurriculumGroup, CurriculumIssue, CurriculumOverview, CurriculumRequirement } from "@/lib/api/schemas";
import { plural } from "@/lib/format";
import { useYear } from "@/features/academic-years/year-context";
import { useCurriculumOverview, useDraftCount, useInvalidateSetup, useSubjects } from "./hooks";
import { DraftsNotice, InfoNote } from "./shared-ui";
import { CurriculumEditor, type EditorTarget } from "./curriculum-editor";
import { CopyCurriculumDialog, type CopyTarget } from "./copy-dialog";
import { CLASSIFICATION_HINT, CLASSIFICATION_LABEL, copySources, demandStatus, gradeIssues, issuesFor } from "./rules";

const CLASSIFICATION_TONE: Record<CurriculumRequirement["classification"], "neutral" | "info" | "accent"> = {
  COMMON: "neutral",
  GRADE_SPECIFIC: "neutral",
  STREAM_SPECIFIC: "info",
  SECTION_SPECIFIC: "accent",
};

export function CurriculumPage() {
  const { year, capabilities, basePath } = useYear();
  const overview = useCurriculumOverview(year.id);
  const subjects = useSubjects();
  const draftCount = useDraftCount(year.id);
  const invalidateSetup = useInvalidateSetup(year.id);
  const invalidate = () => invalidateSetup();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [copying, setCopying] = useState<CopyTarget | null>(null);
  const canEdit = capabilities.canEditSetup;

  const data = overview.data;
  const grades = useMemo(() => [...(data?.grades ?? [])].sort((a, b) => a.displayOrder - b.displayOrder), [data]);
  const visible = useMemo(
    () =>
      grades.filter(
        (g) => matchesQuery(query, g.name) || g.streams.some((s) => matchesQuery(query, s.name)) || g.curricula.some((c) => c.requirements.some((r) => matchesQuery(query, r.subject.name, r.subject.code))),
      ),
    [grades, query],
  );
  const errorCount = data?.issues.filter((i) => i.severity === "ERROR").length ?? 0;

  return (
    <PageBody>
      <PageHeader
        eyebrow={year.name}
        title="Curriculum"
        description="What each grade (or stream) is taught and how many periods a week. The curriculum doesn’t say who teaches: that is set in Teachers (eligibility) and Assignments."
      />

      {!canEdit && capabilities.setupLockedReason ? <ReadOnlyNotice>{capabilities.setupLockedReason}</ReadOnlyNotice> : null}
      {canEdit ? <DraftsNotice count={draftCount} what="the curriculum" /> : null}
      {overview.isError && data ? <StaleDataNotice onRetry={() => void overview.refetch()} /> : null}

      {overview.isPending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading curriculum">
          <CardsSkeleton count={3} />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : overview.isError && !data ? (
        <ErrorState error={overview.error} title="Couldn’t load the curriculum" onRetry={() => void overview.refetch()} />
      ) : !data || grades.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-5" />}
          title="No grades yet"
          description={`The curriculum is set per grade. Add ${year.name}’s grades and sections first.`}
          action={
            <Button asChild>
              <Link href={`${basePath}/classes`}>Go to Classes</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Weekly slots"
              value={data.weeklySlots ?? "Not set"}
              hint={data.weeklySlots !== null ? "Periods a section can have each week" : "Set up the schedule to compare demand"}
              href={`${basePath}/schedule`}
            />
            <StatCard label="Subjects in use" value={data.subjects.length} hint={`Across ${plural(grades.length, "grade")}`} href={`${basePath}/subjects`} />
            <StatCard
              label="Issues to review"
              value={data.issues.length}
              tone={errorCount > 0 ? "danger" : data.issues.length > 0 ? "warning" : "default"}
              hint={errorCount > 0 ? `${plural(errorCount, "error")}` : data.issues.length > 0 ? "Warnings only" : "Nothing flagged"}
            />
          </div>

          <InfoNote>
            <p>
              <span className="font-medium text-foreground">Curriculum is not teacher assignment.</span> Editing it never changes which teachers can teach a subject or who is pinned to a
              section. Changing it does make existing timetable drafts out of date; they can’t be published until generated again. Published timetables are not changed.
            </p>
          </InfoNote>

          {data.issues.length > 0 ? <IssuesPanel overview={data} /> : null}

          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search grades or subjects" label="Search curriculum" />
          </Toolbar>

          {visible.length === 0 ? (
            <NoResults query={query} onClear={() => setQuery("")} />
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-8">
              {visible.map((grade) => (
                <GradeBlock
                  key={grade.id}
                  grade={grade}
                  overview={data}
                  canEdit={canEdit}
                  onEdit={(group) => setEditing({ grade, group })}
                  onCopy={(group) => setCopying({ gradeId: grade.id, streamId: group.streamId, label: group.label })}
                />
              ))}
            </div>
          )}
        </>
      )}

      <CurriculumEditor
        target={editing}
        onClose={() => setEditing(null)}
        subjects={subjects.data ?? []}
        subjectsHref={`${basePath}/subjects`}
        weeklySlots={data?.weeklySlots ?? null}
        draftCount={draftCount}
        invalidate={invalidate}
      />
      <CopyCurriculumDialog target={copying} overview={data} onClose={() => setCopying(null)} invalidate={invalidate} />
    </PageBody>
  );
}

function IssuesPanel({ overview }: { overview: CurriculumOverview }) {
  return (
    <section className="rounded-lg border bg-surface" aria-labelledby="curriculum-issues">
      <h2 id="curriculum-issues" className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
        <AlertTriangle className="size-4 text-warning-foreground dark:text-warning" aria-hidden /> Issues to review
      </h2>
      <ul className="divide-y">
        {overview.issues.map((issue, i) => (
          <IssueRow key={`${issue.code}-${issue.gradeId}-${issue.streamId}-${issue.sectionId ?? i}`} issue={issue} />
        ))}
      </ul>
    </section>
  );
}

function IssueRow({ issue }: { issue: CurriculumIssue }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2.5 text-sm">
      <StatusBadge tone={issue.severity === "ERROR" ? "danger" : "warning"}>{issue.severity === "ERROR" ? "Error" : "Warning"}</StatusBadge>
      <span className="text-foreground">{issue.message}</span>
    </li>
  );
}

function GradeBlock({
  grade,
  overview,
  canEdit,
  onEdit,
  onCopy,
}: {
  grade: CurriculumGrade;
  overview: CurriculumOverview;
  canEdit: boolean;
  onEdit: (group: CurriculumGroup) => void;
  onCopy: (group: CurriculumGroup) => void;
}) {
  const mixed = gradeIssues(overview, grade.id);
  return (
    <Section
      className="min-w-0"
      id={`grade-${grade.id}`}
      title={grade.name}
      description={grade.streamed ? `Uses streams: the curriculum is set per stream · ${plural(grade.sectionCount, "section")}` : plural(grade.sectionCount, "section")}
    >
      {mixed.map((issue) => (
        <div key={issue.code} className="flex items-start gap-2 text-sm">
          <StatusBadge tone="warning">Warning</StatusBadge> <span>{issue.message}</span>
        </div>
      ))}
      <div className="grid min-w-0 grid-cols-1 gap-4">
        {grade.curricula.map((group) => (
          <GroupPanel key={group.streamId ?? "none"} grade={grade} group={group} overview={overview} canEdit={canEdit} onEdit={() => onEdit(group)} onCopy={() => onCopy(group)} />
        ))}
      </div>
    </Section>
  );
}

function GroupPanel({
  grade,
  group,
  overview,
  canEdit,
  onEdit,
  onCopy,
}: {
  grade: CurriculumGrade;
  group: CurriculumGroup;
  overview: CurriculumOverview;
  canEdit: boolean;
  onEdit: () => void;
  onCopy: () => void;
}) {
  const issues = issuesFor(overview, { gradeId: grade.id, streamId: group.streamId }).filter((i) => i.code !== "SECTION_DEMAND_EXCEEDS_SLOTS");
  const hasSources = copySources(overview, { gradeId: grade.id, streamId: group.streamId }).length > 0;
  const sectionName = (id: string) => group.sections.find((s) => s.id === id)?.name ?? "Unknown section";
  const headingId = `group-${grade.id}-${group.streamId ?? "none"}`;

  const columns: DataColumn<CurriculumRequirement>[] = [
    {
      id: "subject",
      header: "Subject",
      sortValue: (r) => r.subject.name.toLowerCase(),
      cell: (r) => (
        <span>
          <span className="font-medium text-foreground">{r.subject.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.subject.code}</span>
        </span>
      ),
    },
    { id: "periods", header: "Periods / week", align: "right", sortValue: (r) => r.periodsPerWeek, cell: (r) => <span className="tabular">{r.periodsPerWeek}</span> },
    {
      id: "type",
      header: "Type",
      cell: (r) => (r.isOptional ? <StatusBadge tone="neutral">Optional</StatusBadge> : <span className="text-muted-foreground">Compulsory</span>),
    },
    {
      id: "scope",
      header: "Taught in",
      hideOnMobile: true,
      cell: (r) =>
        r.sectionScope === "ALL_SECTIONS" ? (
          <span className="text-muted-foreground">All sections</span>
        ) : (
          <span>{r.sectionIds.map(sectionName).join(", ")}</span>
        ),
    },
    {
      id: "classification",
      header: "Applies to",
      hideOnMobile: true,
      cell: (r) => (
        <span title={CLASSIFICATION_HINT[r.classification]}>
          <StatusBadge tone={CLASSIFICATION_TONE[r.classification]} dot={false}>
            {CLASSIFICATION_LABEL[r.classification]}
          </StatusBadge>
        </span>
      ),
    },
  ];

  return (
    <section className="min-w-0 rounded-lg border bg-surface" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="space-y-0.5">
          <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {group.label}
          </h3>
          <p className="text-xs text-muted-foreground tabular">
            {plural(group.requirements.length, "subject")} · {plural(group.totalPeriods, "period")} a week in total · {plural(group.sectionCount, "section")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onCopy} disabled={!canEdit || !hasSources} aria-label={`Copy from another grade into ${group.label}`}>
            <Copy /> Copy from…
          </Button>
          <Button size="sm" onClick={onEdit} disabled={!canEdit} aria-label={`Edit curriculum of ${group.label}`}>
            <Pencil /> Edit curriculum
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {issues.map((issue) => (
          <div key={issue.code} className="flex items-start gap-2 text-sm">
            <StatusBadge tone={issue.severity === "ERROR" ? "danger" : "warning"}>{issue.severity === "ERROR" ? "Error" : "Warning"}</StatusBadge>
            <span>{issue.message}</span>
          </div>
        ))}
        {group.sections.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Weekly periods per section{overview.weeklySlots !== null ? ` (of ${overview.weeklySlots} slots)` : ""}:</span>
            <ul className="flex flex-wrap gap-1.5" aria-label={`Weekly periods per section of ${group.label}`}>
              {group.sections.map((s) => {
                const status = demandStatus(s.periodsPerWeek, overview.weeklySlots);
                return (
                  <li key={s.id}>
                    <StatusBadge tone={status === "over" ? "danger" : status === "exact" ? "success" : "neutral"} dot={false}>
                      {s.name}: {s.periodsPerWeek}
                      {overview.weeklySlots !== null ? ` / ${overview.weeklySlots}` : ""}
                      {status === "over" ? " (too many)" : ""}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {group.requirements.length === 0 ? (
          <EmptyState
            compact
            title="No subjects yet"
            description={canEdit ? `Add the subjects ${group.label} is taught, or copy them from another grade.` : `${group.label} has no curriculum.`}
            action={
              canEdit ? (
                <>
                  <Button size="sm" onClick={onEdit}>
                    <Plus /> Add subjects
                  </Button>
                  {hasSources ? (
                    <Button size="sm" variant="outline" onClick={onCopy}>
                      <Copy /> Copy from…
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          />
        ) : (
          <DataTable data={group.requirements} columns={columns} getRowId={(r) => r.id} caption={`Curriculum of ${group.label}`} pageSize={60} dense initialSort={{ id: "subject" }} />
        )}
      </div>
    </section>
  );
}
