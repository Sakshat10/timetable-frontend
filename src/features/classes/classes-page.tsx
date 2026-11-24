"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, GraduationCap, Info, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { SearchInput, Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, NoResults, ReadOnlyNotice, StaleDataNotice, CardsSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DeleteRecordDialog } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { gradesApi, sectionsApi, streamsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { CurriculumGrade, CurriculumGroup } from "@/lib/api/schemas";
import { notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useYear } from "@/features/academic-years/year-context";
import { useCurriculumOverview, useDraftCount, useInvalidateSetup } from "@/features/curriculum/hooks";
import { DraftsNotice, InfoNote } from "@/features/curriculum/shared-ui";
import { BulkStructureDialog } from "./bulk-structure-dialog";
import { GradeDialog, SectionDialog, StreamDialog, type SectionRef, type StreamRef } from "./classes-dialogs";
import { canAddStream, filterGrades, gradeMode, nextDisplayOrder, sectionNeedsStream, sortGrades, structureTotals, type GradeMode } from "./rules";

type DialogState =
  | null
  | { kind: "grade"; grade?: CurriculumGrade }
  | { kind: "bulk" }
  | { kind: "stream"; grade: CurriculumGrade; stream?: StreamRef }
  | { kind: "section"; grade: CurriculumGrade; streamId?: string | null; section?: SectionRef }
  | { kind: "delete"; what: string; name: string; consequence?: string; run: () => Promise<unknown> };

const MODE_BADGE: Record<GradeMode, { label: string; tone: "neutral" | "info" | "warning" }> = {
  empty: { label: "No sections yet", tone: "neutral" },
  unstreamed: { label: "No streams", tone: "neutral" },
  streamed: { label: "Uses streams", tone: "info" },
  mixed: { label: "Mixed: review", tone: "warning" },
};

export function ClassesPage() {
  const { year, capabilities, basePath } = useYear();
  const overview = useCurriculumOverview(year.id);
  const draftCount = useDraftCount(year.id);
  const invalidateSetup = useInvalidateSetup(year.id);
  const invalidate = () => invalidateSetup();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const canEdit = capabilities.canEditSetup;

  const grades = useMemo(() => sortGrades(overview.data?.grades ?? []), [overview.data]);
  const visible = useMemo(() => filterGrades(grades, query), [grades, query]);
  const totals = overview.data ? structureTotals(overview.data) : null;
  const close = () => setDialog(null);

  const remove = (what: string, name: string, action: () => Promise<unknown>, consequence?: string) =>
    setDialog({
      kind: "delete",
      what,
      name,
      consequence,
      run: async () => {
        try {
          await action();
        } catch (error) {
          if (isApiError(error) && error.uncertain) await invalidate();
          throw error;
        }
        await invalidate();
        notifySuccess(`${what[0].toUpperCase()}${what.slice(1)} deleted`, name);
      },
    });

  const actions = {
    editGrade: (grade: CurriculumGrade) => setDialog({ kind: "grade", grade }),
    deleteGrade: (grade: CurriculumGrade) => remove("grade", grade.name, () => gradesApi.remove(grade.id), "A grade can be deleted only when it has no sections, streams, curriculum or teacher eligibility left."),
    addStream: (grade: CurriculumGrade) => setDialog({ kind: "stream", grade }),
    editStream: (grade: CurriculumGrade, stream: StreamRef) => setDialog({ kind: "stream", grade, stream }),
    deleteStream: (grade: CurriculumGrade, stream: StreamRef) =>
      remove("stream", `${grade.name} · ${stream.name}`, () => streamsApi.remove(stream.id), "A stream can be deleted only when it has no sections or curriculum left."),
    addSection: (grade: CurriculumGrade, streamId?: string | null) => setDialog({ kind: "section", grade, streamId }),
    editSection: (grade: CurriculumGrade, section: SectionRef) => setDialog({ kind: "section", grade, section }),
    deleteSection: (grade: CurriculumGrade, section: SectionRef) =>
      remove(
        "section",
        `${grade.name} · ${section.name}`,
        () => sectionsApi.remove(section.id),
        "A section that has teacher assignments, is chosen in a curriculum line, or has lessons in any timetable version (including published history) can’t be deleted.",
      ),
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow={year.name}
        title="Classes"
        description={<>Grades, streams and sections of {year.name}. Sections are the classes a timetable is made for.</>}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog({ kind: "bulk" })} disabled={!canEdit || !overview.data}>
              <Layers /> Add several grades
            </Button>
            <Button onClick={() => setDialog({ kind: "grade" })} disabled={!canEdit || !overview.data}>
              <Plus /> Add grade
            </Button>
          </>
        }
      />

      {totals ? (
        <dl className="grid grid-cols-3 gap-3 sm:max-w-xl" aria-label="Class structure totals">
          {[
            { label: "Grades", value: totals.grades },
            { label: "Streams", value: totals.streams },
            { label: "Sections", value: totals.sections },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border bg-surface px-4 py-3 shadow-xs">
              <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
              <dd className="text-xl font-semibold text-foreground tabular">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {!canEdit && capabilities.setupLockedReason ? <ReadOnlyNotice>{capabilities.setupLockedReason}</ReadOnlyNotice> : null}
      {canEdit ? <DraftsNotice count={draftCount} what="classes" /> : null}

      <InfoNote>
        <p>
          <span className="font-medium text-foreground">Streams are all or nothing per grade.</span> A grade either uses streams (for example Science and Commerce) for every
          section, or for none. In a streamed grade each section belongs to one stream and the curriculum is set per stream.
        </p>
      </InfoNote>

      {overview.isError && overview.data ? <StaleDataNotice onRetry={() => void overview.refetch()} /> : null}

      {overview.isPending ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading classes">
          <Skeleton className="h-9 w-72 max-w-full" />
          <CardsSkeleton count={2} />
        </div>
      ) : overview.isError && !overview.data ? (
        <ErrorState error={overview.error} title="Couldn’t load classes" onRetry={() => void overview.refetch()} />
      ) : grades.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No grades yet"
          description={canEdit ? "Start with your grades and their sections. You can add them one by one or several at once." : `${year.name} has no grades.`}
          action={
            canEdit ? (
              <>
                <Button onClick={() => setDialog({ kind: "grade" })}>
                  <Plus /> Add grade
                </Button>
                <Button variant="outline" onClick={() => setDialog({ kind: "bulk" })}>
                  <Layers /> Add several grades
                </Button>
              </>
            ) : null
          }
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search grades, streams or sections" label="Search classes" />
            <Button asChild variant="outline" className="sm:ml-auto">
              <Link href={`${basePath}/curriculum`}>
                <BookOpenCheck /> Set the curriculum
              </Link>
            </Button>
          </Toolbar>
          {visible.length === 0 ? (
            <NoResults query={query} onClear={() => setQuery("")} />
          ) : (
            <ul className="grid gap-4" aria-label="Grades">
              {visible.map((grade) => (
                <GradeCard key={grade.id} grade={grade} canEdit={canEdit} actions={actions} />
              ))}
            </ul>
          )}
        </>
      )}

      <GradeDialog
        open={dialog?.kind === "grade"}
        onOpenChange={(o) => !o && close()}
        yearId={year.id}
        grade={dialog?.kind === "grade" ? dialog.grade : undefined}
        suggestedOrder={nextDisplayOrder(grades)}
        invalidate={invalidate}
      />
      <BulkStructureDialog open={dialog?.kind === "bulk"} onOpenChange={(o) => !o && close()} yearId={year.id} existing={grades} invalidate={invalidate} />
      <StreamDialog
        open={dialog?.kind === "stream"}
        onOpenChange={(o) => !o && close()}
        grade={dialog?.kind === "stream" ? dialog.grade : null}
        stream={dialog?.kind === "stream" ? dialog.stream : undefined}
        invalidate={invalidate}
      />
      <SectionDialog
        open={dialog?.kind === "section"}
        onOpenChange={(o) => !o && close()}
        grade={dialog?.kind === "section" ? dialog.grade : null}
        needsStream={dialog?.kind === "section" ? sectionNeedsStream(dialog.grade) : false}
        defaultStreamId={dialog?.kind === "section" ? dialog.streamId : null}
        section={dialog?.kind === "section" ? dialog.section : undefined}
        invalidate={invalidate}
      />
      <DeleteRecordDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && close()}
        what={dialog?.kind === "delete" ? dialog.what : "record"}
        name={dialog?.kind === "delete" ? dialog.name : ""}
        consequence={dialog?.kind === "delete" && dialog.consequence ? <p className="text-muted-foreground">{dialog.consequence}</p> : undefined}
        onDelete={() => (dialog?.kind === "delete" ? dialog.run() : Promise.resolve())}
      />
    </PageBody>
  );
}

interface CardActions {
  editGrade: (grade: CurriculumGrade) => void;
  deleteGrade: (grade: CurriculumGrade) => void;
  addStream: (grade: CurriculumGrade) => void;
  editStream: (grade: CurriculumGrade, stream: StreamRef) => void;
  deleteStream: (grade: CurriculumGrade, stream: StreamRef) => void;
  addSection: (grade: CurriculumGrade, streamId?: string | null) => void;
  editSection: (grade: CurriculumGrade, section: SectionRef) => void;
  deleteSection: (grade: CurriculumGrade, section: SectionRef) => void;
}

function GradeCard({ grade, canEdit, actions }: { grade: CurriculumGrade; canEdit: boolean; actions: CardActions }) {
  const mode = gradeMode(grade);
  const badge = MODE_BADGE[mode];
  const streamAllowed = canAddStream(grade);
  const headingId = `grade-${grade.id}`;
  // Streamed grades: one block per stream (plus legacy unstreamed sections, if any). Others: the grade's sections.
  const groups = grade.curricula.filter((g) => g.streamId !== null || g.sectionCount > 0 || grade.streams.length === 0);
  const streamed = grade.streams.length > 0;

  return (
    <li className="overflow-hidden rounded-xl border bg-surface shadow-card" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-[15px] font-semibold text-accent-foreground tabular"
            aria-hidden
          >
            {gradeInitials(grade.name)}
          </span>
          <div className="min-w-0 space-y-1">
            <h2 id={headingId} className="truncate text-[17px] leading-6 font-semibold text-foreground">
              {grade.name}
            </h2>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              <span className="text-xs text-muted-foreground tabular">
                {plural(grade.sectionCount, "section")}
                {streamed ? ` · ${plural(grade.streams.length, "stream")}` : ""} · Order {grade.displayOrder}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => actions.addSection(grade)} disabled={!canEdit}>
            <Plus /> Add section
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${grade.name}`} disabled={!canEdit}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => actions.editGrade(grade)}>
                <Pencil /> Edit grade
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.addStream(grade)} disabled={!streamAllowed}>
                <Plus /> Add stream
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => actions.deleteGrade(grade)}>
                <Trash2 /> Delete grade
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className={cn("border-t bg-surface-subtle px-5 py-4", streamed ? "grid gap-3 lg:grid-cols-2" : "")}>
        {groups.map((group) => (
          <GroupBlock key={group.streamId ?? "none"} grade={grade} group={group} canEdit={canEdit} actions={actions} />
        ))}
      </div>
      {mode === "unstreamed" ? (
        <p className="flex items-center gap-2 border-t px-5 py-2.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          This grade has sections without streams, so streams can’t be added to it.
        </p>
      ) : null}
    </li>
  );
}

function gradeInitials(name: string): string {
  const digits = /\d+/.exec(name)?.[0];
  if (digits) return digits.slice(0, 3);
  return name.trim().slice(0, 2).toUpperCase();
}

function GroupBlock({ grade, group, canEdit, actions }: { grade: CurriculumGrade; group: CurriculumGroup; canEdit: boolean; actions: CardActions }) {
  const stream = group.stream;
  const inStreamedGrade = grade.streams.length > 0;
  const sections =
    group.sections.length === 0 ? (
      <p className={cn("text-sm text-muted-foreground", inStreamedGrade ? "px-4 py-3" : "py-1")}>No sections yet.</p>
    ) : (
      <ul
        className={cn(inStreamedGrade ? "divide-y" : "grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3")}
        aria-label={`Sections of ${group.label}`}
      >
        {group.sections.map((section) => (
          <li
            key={section.id}
            className={cn(
              "group/section flex items-center justify-between gap-2",
              inStreamedGrade ? "px-4 py-2.5 hover:bg-surface-subtle" : "rounded-lg border bg-surface px-3.5 py-3 shadow-xs",
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-surface text-xs font-semibold text-foreground" aria-hidden>
                {section.code}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{section.name}</p>
                <p className="truncate text-xs text-muted-foreground tabular">
                  Code {section.code} · {section.periodsPerWeek} periods/week
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center">
              <Button variant="ghost" size="icon-sm" onClick={() => actions.editSection(grade, section)} disabled={!canEdit} aria-label={`Edit section ${grade.name} ${section.name}`}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hover:bg-destructive-muted hover:text-destructive"
                onClick={() => actions.deleteSection(grade, section)}
                disabled={!canEdit}
                aria-label={`Delete section ${grade.name} ${section.name}`}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );

  if (!inStreamedGrade) return sections;

  return (
    <div className="overflow-hidden rounded-lg border bg-surface shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-l-[3px] border-l-primary/70 px-4 py-2.5">
        {stream ? (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Stream</span>
              <h3 className="truncate text-sm font-semibold text-foreground">{stream.name}</h3>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{stream.code}</span>
            </div>
            <div className="flex items-center">
              <Button variant="ghost" size="sm" onClick={() => actions.addSection(grade, stream.id)} disabled={!canEdit} aria-label={`Add section to ${grade.name} ${stream.name}`}>
                <Plus /> Section
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => actions.editStream(grade, stream)} disabled={!canEdit} aria-label={`Edit stream ${stream.name}`}>
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hover:bg-destructive-muted hover:text-destructive"
                onClick={() => actions.deleteStream(grade, stream)}
                disabled={!canEdit}
                aria-label={`Delete stream ${stream.name}`}
              >
                <Trash2 />
              </Button>
            </div>
          </>
        ) : (
          <h3 className="text-sm font-semibold text-foreground">Sections without a stream</h3>
        )}
      </div>
      {sections}
    </div>
  );
}
