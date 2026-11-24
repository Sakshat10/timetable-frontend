"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { GraduationCap, Layers, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
        description={
          <>
            Grades, streams and sections of {year.name}. Sections are the classes a timetable is made for.
            {totals ? (
              <span className="mt-1 block tabular">
                {plural(totals.grades, "grade")} · {plural(totals.streams, "stream")} · {plural(totals.sections, "section")}
              </span>
            ) : null}
          </>
        }
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
            <Link href={`${basePath}/curriculum`} className="text-sm font-medium text-primary hover:underline sm:ml-auto">
              Set the curriculum
            </Link>
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

  return (
    <li className="rounded-lg border bg-surface" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0 space-y-1.5">
          <h2 id={headingId} className="text-base font-semibold text-foreground">
            {grade.name}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            <span className="text-xs text-muted-foreground tabular">
              Order {grade.displayOrder} · {plural(grade.sectionCount, "section")}
              {grade.streams.length > 0 ? ` · ${plural(grade.streams.length, "stream")}` : ""}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
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
      <div className="divide-y">
        {groups.map((group) => (
          <GroupBlock key={group.streamId ?? "none"} grade={grade} group={group} canEdit={canEdit} actions={actions} />
        ))}
      </div>
      {mode === "unstreamed" ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">This grade has sections without streams, so streams can’t be added to it.</p>
      ) : null}
    </li>
  );
}

function GroupBlock({ grade, group, canEdit, actions }: { grade: CurriculumGrade; group: CurriculumGroup; canEdit: boolean; actions: CardActions }) {
  const stream = group.stream;
  return (
    <div className="px-4 py-3">
      {stream ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {stream.name} <span className="font-normal text-muted-foreground">({stream.code})</span>
          </h3>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => actions.addSection(grade, stream.id)} disabled={!canEdit} aria-label={`Add section to ${grade.name} ${stream.name}`}>
              <Plus /> Section
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => actions.editStream(grade, stream)} disabled={!canEdit} aria-label={`Edit stream ${stream.name}`}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => actions.deleteStream(grade, stream)} disabled={!canEdit} aria-label={`Delete stream ${stream.name}`}>
              <Trash2 />
            </Button>
          </div>
        </div>
      ) : grade.streams.length > 0 ? (
        <h3 className="mb-2 text-sm font-medium text-foreground">Sections without a stream</h3>
      ) : null}
      {group.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sections yet.</p>
      ) : (
        <ul className="grid gap-1" aria-label={`Sections of ${group.label}`}>
          {group.sections.map((section) => (
            <li key={section.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
              <div className="min-w-0 text-sm">
                <span className="font-medium text-foreground">{section.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">Code {section.code}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="mr-1 hidden text-xs text-muted-foreground tabular sm:inline">{section.periodsPerWeek} periods/week in curriculum</span>
                <Button variant="ghost" size="icon-sm" onClick={() => actions.editSection(grade, section)} disabled={!canEdit} aria-label={`Edit section ${grade.name} ${section.name}`}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => actions.deleteSection(grade, section)} disabled={!canEdit} aria-label={`Delete section ${grade.name} ${section.name}`}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
