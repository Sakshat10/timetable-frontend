"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ListPlus, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { matchesQuery, SearchInput, Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, NoResults, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { DeleteRecordDialog } from "@/components/shared/confirm-dialog";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { subjectsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { Subject } from "@/lib/api/types";
import type { CurriculumOverview } from "@/lib/api/schemas";
import { notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { useYear } from "@/features/academic-years/year-context";
import { useCurriculumOverview, useInvalidateSetup, useSubjects } from "@/features/curriculum/hooks";
import { BulkSubjectsDialog, SubjectDialog } from "./subject-dialogs";
import { gradeCounts, subjectUsage } from "./rules";

type DialogState = null | { kind: "create" } | { kind: "bulk" } | { kind: "edit"; subject: Subject } | { kind: "delete"; subject: Subject };

export function SubjectsPage() {
  const { year, basePath } = useYear();
  const subjects = useSubjects();
  const overview = useCurriculumOverview(year.id);
  const invalidateSetup = useInvalidateSetup(year.id);
  const invalidate = () => invalidateSetup({ subjects: true });
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const counts = useMemo(() => gradeCounts(overview.data), [overview.data]);
  const rows = useMemo(() => (subjects.data ?? []).filter((s) => matchesQuery(query, s.name, s.code)), [subjects.data, query]);
  const details = subjects.data?.find((s) => s.id === detailsId) ?? null;

  const columns = useMemo<DataColumn<Subject>[]>(
    () => [
      {
        id: "name",
        header: "Subject",
        sortValue: (s) => s.name.toLowerCase(),
        cell: (s) => (
          <button type="button" className="text-left font-medium text-foreground hover:underline" onClick={() => setDetailsId(s.id)}>
            {s.name}
          </button>
        ),
      },
      { id: "code", header: "Code", sortValue: (s) => s.code, cell: (s) => <span className="font-mono text-xs">{s.code}</span> },
      {
        id: "usage",
        header: `Used in ${year.name}`,
        sortValue: (s) => counts.get(s.id) ?? 0,
        cell: (s) =>
          overview.data ? (
            (counts.get(s.id) ?? 0) > 0 ? (
              <span className="tabular">{plural(counts.get(s.id) ?? 0, "grade")}</span>
            ) : (
              <span className="text-muted-foreground">Not in any curriculum</span>
            )
          ) : overview.isError ? (
            <span className="text-muted-foreground">Unavailable</span>
          ) : (
            <span className="text-muted-foreground">…</span>
          ),
      },
      {
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (s) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDetailsId(s.id)}>
                <BookOpen /> View usage
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", subject: s })}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "delete", subject: s })}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [counts, overview.data, overview.isError, year.name],
  );

  return (
    <PageBody>
      <PageHeader
        title="Subjects"
        description={`Subjects are school-wide: the same list is used in every academic year, and editing it is not limited to draft years. Usage shows the curriculum of ${year.name}.`}
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog({ kind: "bulk" })}>
              <ListPlus /> Add several
            </Button>
            <Button onClick={() => setDialog({ kind: "create" })}>
              <Plus /> Add subject
            </Button>
          </>
        }
      />

      {subjects.isError && subjects.data ? <StaleDataNotice onRetry={() => void subjects.refetch()} /> : null}

      {subjects.isPending ? (
        <TableSkeleton columns={3} />
      ) : subjects.isError && !subjects.data ? (
        <ErrorState error={subjects.error} title="Couldn’t load subjects" onRetry={() => void subjects.refetch()} />
      ) : subjects.data.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-5" />}
          title="No subjects yet"
          description="Add the subjects your school teaches. Then set how many periods each grade has in the curriculum."
          action={
            <>
              <Button onClick={() => setDialog({ kind: "create" })}>
                <Plus /> Add subject
              </Button>
              <Button variant="outline" onClick={() => setDialog({ kind: "bulk" })}>
                <ListPlus /> Add several
              </Button>
            </>
          }
        />
      ) : (
        <>
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search by name or code" label="Search subjects" />
            <span className="text-sm text-muted-foreground tabular sm:ml-auto">{plural(subjects.data.length, "subject")}</span>
          </Toolbar>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(s) => s.id}
            caption="Subjects"
            initialSort={{ id: "name" }}
            dense
            empty={<NoResults query={query} onClear={() => setQuery("")} />}
          />
        </>
      )}

      <SubjectDetailsSheet
        subject={details}
        overview={overview.data}
        overviewError={overview.isError && !overview.data}
        yearName={year.name}
        curriculumHref={`${basePath}/curriculum`}
        onOpenChange={(o) => !o && setDetailsId(null)}
        onEdit={(s) => setDialog({ kind: "edit", subject: s })}
        onDelete={(s) => setDialog({ kind: "delete", subject: s })}
      />
      <SubjectDialog open={dialog?.kind === "create" || dialog?.kind === "edit"} onOpenChange={(o) => !o && setDialog(null)} subject={dialog?.kind === "edit" ? dialog.subject : undefined} invalidate={invalidate} />
      <BulkSubjectsDialog open={dialog?.kind === "bulk"} onOpenChange={(o) => !o && setDialog(null)} invalidate={invalidate} />
      <DeleteRecordDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        what="subject"
        name={dialog?.kind === "delete" ? `${dialog.subject.name} (${dialog.subject.code})` : ""}
        consequence={<p className="text-muted-foreground">A subject used in any year’s curriculum, linked to a teacher, or present in a timetable can’t be deleted.</p>}
        onDelete={async () => {
          if (dialog?.kind !== "delete") return;
          const subject = dialog.subject;
          try {
            await subjectsApi.remove(subject.id);
          } catch (error) {
            if (isApiError(error) && error.uncertain) await invalidate();
            throw error;
          }
          if (detailsId === subject.id) setDetailsId(null);
          await invalidate();
          notifySuccess("Subject deleted", `${subject.name} (${subject.code})`);
        }}
      />
    </PageBody>
  );
}

function SubjectDetailsSheet({
  subject,
  overview,
  overviewError,
  yearName,
  curriculumHref,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  subject: Subject | null;
  overview: CurriculumOverview | undefined;
  overviewError: boolean;
  yearName: string;
  curriculumHref: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (s: Subject) => void;
  onDelete: (s: Subject) => void;
}) {
  const usage = subject ? subjectUsage(overview, subject.id) : [];
  return (
    <Sheet open={subject !== null} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {subject ? (
          <>
            <SheetHeader>
              <SheetTitle>{subject.name}</SheetTitle>
              <SheetDescription>
                Code <span className="font-mono">{subject.code}</span> · school-wide subject
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-3 px-4">
              <h3 className="text-sm font-semibold text-foreground">Curriculum in {yearName}</h3>
              {overviewError ? (
                <p className="text-sm text-muted-foreground">The curriculum couldn’t be loaded, so usage isn’t shown.</p>
              ) : !overview ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : usage.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not part of any grade’s curriculum in {yearName}.{" "}
                  <Link href={curriculumHref} className="font-medium text-primary hover:underline">
                    Open the curriculum
                  </Link>
                </p>
              ) : (
                <ul className="divide-y rounded-lg border" aria-label={`Where ${subject.name} is taught in ${yearName}`}>
                  {usage.map((grade) => (
                    <li key={grade.gradeId} className="space-y-1 px-3 py-2.5">
                      <p className="text-sm font-medium text-foreground">{grade.gradeName}</p>
                      <ul className="space-y-1">
                        {grade.lines.map((line, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            {line.streamName ? <span>{line.streamName}:</span> : null}
                            <span className="tabular">{plural(line.periodsPerWeek, "period")} a week</span>
                            {line.isOptional ? <StatusBadge tone="neutral">Optional</StatusBadge> : null}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <SheetFooter className="flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => onDelete(subject)}>
                <Trash2 /> Delete
              </Button>
              <Button onClick={() => onEdit(subject)}>
                <Pencil /> Edit
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
