"use client";

import { useMemo, useState } from "react";
import { BookOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Section } from "@/components/shared/page-header";
import { EmptyState, ErrorState, ReadOnlyNotice, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useYear } from "@/features/academic-years/year-context";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import type { GradeScope, Teacher, TeacherSubjectLink, TeacherSubjectType } from "@/lib/api/types";
import { AddSubjectDialog } from "./add-subject-dialog";
import { useLinkGrades, useRemoveLink, useSubjects, useTeacherLinks, useToggleGrade, useUpdateLink, useYearGrades } from "./hooks";
import { GRADE_SCOPE_LABEL, eligibilitySummary, linkEligibility, rowsForYear, type LinkEligibility } from "./rules";

export function SubjectEligibilitySection({ teacher }: { teacher: Pick<Teacher, "id" | "name" | "isActive"> }) {
  const { year, capabilities } = useYear();
  const links = useTeacherLinks(teacher.id);
  const linkGrades = useLinkGrades(links.data);
  const grades = useYearGrades(year.id);
  const subjects = useSubjects();
  const updateLink = useUpdateLink(year.id, teacher.id);
  const toggleGrade = useToggleGrade(year.id, teacher.id);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<TeacherSubjectLink | null>(null);
  const removeLink = useRemoveLink(year.id, teacher.id);
  const [pendingCells, setPendingCells] = useState<ReadonlySet<string>>(new Set());
  const [pendingLinks, setPendingLinks] = useState<ReadonlySet<string>>(new Set());

  const sortedGrades = useMemo(() => [...(grades.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)), [grades.data]);
  const gradeName = (id: string) => sortedGrades.find((g) => g.id === id)?.name;
  const linkedSubjectIds = useMemo(() => new Set((links.data ?? []).map((l) => l.subjectId)), [links.data]);
  const sortedLinks = useMemo(() => [...(links.data ?? [])].sort((a, b) => a.subject.name.localeCompare(b.subject.name)), [links.data]);
  const canEditEligibility = capabilities.canEditSetup;

  async function changeLink(link: TeacherSubjectLink, body: { type?: TeacherSubjectType; gradeScope?: GradeScope }) {
    if (pendingLinks.has(link.id)) return;
    setPendingLinks((s) => new Set(s).add(link.id));
    try {
      await updateLink.mutateAsync({ linkId: link.id, body });
      if (body.gradeScope === "SELECTED_GRADES") {
        const rows = rowsForYear(linkGrades.byLink.get(link.id), year.id);
        notifyInfo(
          `${link.subject.name}: selected grades only`,
          rows.length === 0 ? `Not eligible for any grade in ${year.name} yet. Tick the grades below.` : undefined,
        );
      } else {
        notifySuccess(`${link.subject.name} updated`);
      }
    } catch (error) {
      notifyError(error, isApiError(error) && error.isConflict ? "Can’t restrict to selected grades" : "Couldn’t update the subject");
    } finally {
      setPendingLinks((s) => {
        const next = new Set(s);
        next.delete(link.id);
        return next;
      });
    }
  }

  async function setEligible(link: TeacherSubjectLink, gradeId: string, eligible: boolean) {
    const key = `${link.id}:${gradeId}`;
    if (pendingCells.has(key)) return;
    setPendingCells((s) => new Set(s).add(key));
    try {
      await toggleGrade.mutateAsync({ linkId: link.id, gradeId, eligible });
    } catch (error) {
      notifyError(error, eligible ? "Couldn’t add the grade" : "Couldn’t remove the grade");
    } finally {
      setPendingCells((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  const addButton = (
    <Button size="sm" onClick={() => setAddOpen(true)} disabled={!teacher.isActive || subjects.isPending}>
      <Plus /> Add subject
    </Button>
  );

  return (
    <Section
      id="subjects"
      title="Subjects and grade eligibility"
      description={
        <>
          Eligibility decides which teachers the generator may choose; it does not assign them to a class. Grades are for <span className="font-medium text-foreground">{year.name}</span>.
        </>
      }
      actions={addButton}
    >
      {!teacher.isActive ? (
        <ReadOnlyNotice>This teacher is inactive, so new subjects can’t be added. Existing subjects and grades can still be changed.</ReadOnlyNotice>
      ) : null}
      {!canEditEligibility && capabilities.setupLockedReason ? (
        <ReadOnlyNotice>
          {capabilities.setupLockedReason} Grade eligibility for {year.name} can’t be changed. Subjects and grade scope apply to every year and can still be edited.
        </ReadOnlyNotice>
      ) : null}

      {links.isPending || grades.isPending ? (
        <TableSkeleton rows={3} columns={4} />
      ) : (links.isError && !links.data) || (grades.isError && !grades.data) ? (
        <ErrorState
          compact
          error={links.error ?? grades.error}
          title="Couldn’t load subjects and grades"
          onRetry={() => {
            void links.refetch();
            void grades.refetch();
          }}
        />
      ) : sortedLinks.length === 0 ? (
        <EmptyState
          compact
          icon={<BookOpen className="size-5" />}
          title="No subjects yet"
          description="Add the subjects this teacher is qualified to teach. Without a subject, the teacher can’t be chosen or pinned to any class."
          action={teacher.isActive ? addButton : null}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {links.isError || grades.isError || linkGrades.error ? (
            <StaleDataNotice
              onRetry={() => {
                void links.refetch();
                void grades.refetch();
                void linkGrades.refetch();
              }}
            />
          ) : null}
          <div className="overflow-hidden rounded-lg border bg-surface">
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Subjects and grade eligibility for {year.name}</caption>
                <thead className="bg-muted/50">
                  <tr className="border-b">
                    <th scope="col" className="h-10 px-3 pl-4 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                      Subject
                    </th>
                    <th scope="col" className="h-10 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                      Type
                    </th>
                    <th scope="col" className="h-10 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                      Grade scope
                    </th>
                    {sortedGrades.map((g) => (
                      <th key={g.id} scope="col" className="h-10 px-3 text-center text-xs font-medium whitespace-nowrap text-muted-foreground">
                        {g.name}
                      </th>
                    ))}
                    <th scope="col" className="h-10 px-3 pr-4 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLinks.map((link) => {
                    const rows = linkGrades.byLink.get(link.id);
                    const rowsLoading = link.gradeScope === "SELECTED_GRADES" && rows === undefined;
                    const eligibility: LinkEligibility | null = rowsLoading ? null : linkEligibility(link, rows, year.id);
                    const linkBusy = pendingLinks.has(link.id);
                    return (
                      <tr key={link.id} className="border-b align-top last:border-b-0" data-testid={`link-row-${link.subject.code}`}>
                        <th scope="row" className="px-3 py-2.5 pl-4 text-left font-normal">
                          <div className="font-medium text-foreground">{link.subject.name}</div>
                          <div className="mt-0.5 text-xs">
                            {eligibility === null ? (
                              <span className="text-muted-foreground">Loading grades…</span>
                            ) : eligibility.kind === "NONE" ? (
                              <StatusBadge tone="warning">Not eligible for any grade yet</StatusBadge>
                            ) : (
                              <span className="text-muted-foreground">{eligibilitySummary(eligibility, gradeName)}</span>
                            )}
                          </div>
                        </th>
                        <td className="px-3 py-2">
                          <Select value={link.type} onValueChange={(v) => void changeLink(link, { type: v as TeacherSubjectType })} disabled={linkBusy}>
                            <SelectTrigger size="sm" className="w-32" aria-label={`${link.subject.name} type`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PRIMARY">Primary</SelectItem>
                              <SelectItem value="SECONDARY">Secondary</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Select value={link.gradeScope} onValueChange={(v) => void changeLink(link, { gradeScope: v as GradeScope })} disabled={linkBusy}>
                            <SelectTrigger size="sm" className="w-40" aria-label={`${link.subject.name} grade scope`}>
                              <SelectValue>{GRADE_SCOPE_LABEL[link.gradeScope]}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="SELECTED_GRADES">Selected grades</SelectItem>
                              <SelectItem value="ALL_GRADES">All grades</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {sortedGrades.map((g) => {
                          if (link.gradeScope === "ALL_GRADES") {
                            return (
                              <td key={g.id} className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                                All
                              </td>
                            );
                          }
                          const key = `${link.id}:${g.id}`;
                          const busy = pendingCells.has(key);
                          const checked = eligibility?.kind === "SELECTED" && eligibility.gradeIds.includes(g.id);
                          return (
                            <td key={g.id} className="px-3 py-2 text-center">
                              <span className="inline-flex size-7 items-center justify-center">
                                {busy ? (
                                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving" />
                                ) : (
                                  <Checkbox
                                    checked={checked}
                                    disabled={!canEditEligibility || rowsLoading}
                                    aria-label={`${link.subject.name}: eligible for ${g.name}`}
                                    onCheckedChange={(value) => void setEligible(link, g.id, value === true)}
                                  />
                                )}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 pr-4 text-right">
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${link.subject.name}`} onClick={() => setRemoving(link)} disabled={linkBusy}>
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {sortedGrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">{year.name} has no grades yet. Add classes first, then tick the grades here.</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            “Selected grades” needs a tick for each grade in every academic year; with no tick the teacher is not eligible for any grade. “All grades” covers every
            grade automatically. The type (primary or secondary) is used only to rank substitutes.
          </p>
        </div>
      )}

      <AddSubjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        yearId={year.id}
        teacherId={teacher.id}
        teacherName={teacher.name}
        subjects={subjects.data ?? []}
        linkedSubjectIds={linkedSubjectIds}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (!open ? setRemoving(null) : undefined)}
        title={`Remove ${removing?.subject.name ?? "subject"}?`}
        description={`${teacher.name} will no longer be qualified for ${removing?.subject.name ?? "this subject"}, and its grade eligibility in every year is removed.`}
        confirmLabel="Remove subject"
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeLink.mutateAsync(removing.id);
            notifySuccess("Subject removed", removing.subject.name);
          } catch (error) {
            if (isApiError(error) && error.uncertain) {
              notifyError(error, "Couldn’t confirm the removal");
              return;
            }
            throw error;
          }
        }}
      >
        <p className="text-muted-foreground">If the teacher is pinned to classes for this subject, the server refuses: unpin them on the Assignments page first.</p>
      </ConfirmDialog>
    </Section>
  );
}
