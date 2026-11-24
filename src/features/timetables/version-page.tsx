"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CircleAlert, Copy, Info, Lock, LockOpen, PencilLine, Redo2, Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { ErrorState, PageSkeleton, ReadOnlyNotice, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { useBreadcrumb } from "@/components/layout/breadcrumbs";
import { useYear } from "@/features/academic-years/year-context";
import { VersionStatusBadge } from "@/features/academic-years/year-status-badge";
import type { TimetableView } from "@/lib/api/types";
import { formatTimestamp } from "@/lib/dates";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCurriculum, useIsNarrow, useIsWide, useTeachers, useValidation, useVersion, useVersions, useView } from "./hooks";
import { PublishPanel, ValidationSummary } from "./publish-panel";
import { editGate, idsToChange, type Lesson } from "./rules";
import { TimetableGrid, type GridMode } from "./timetable-grid";
import { useTimetableEditor, type EditorNotice } from "./use-editor";
import { CloneVersionDialog } from "./version-actions";
import { SOURCE_LABEL, StaleBadge } from "./versions-page";

interface Entity {
  id: string;
  label: string;
  group: string;
}

export function VersionPage({ versionId }: { versionId: string }) {
  const { year, basePath, capabilities } = useYear();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const wide = useIsWide();
  const narrow = useIsNarrow();

  const viewKind: "section" | "teacher" = search.get("view") === "teacher" ? "teacher" : "section";
  const requestedEdit = search.get("mode") === "edit";

  const versionQuery = useVersion(versionId, requestedEdit);
  const version = versionQuery.data;
  const versions = useVersions(year.id);
  const validation = useValidation(versionId, Boolean(version));
  const curriculum = useCurriculum(year.id);
  const teachers = useTeachers();
  const summary = versions.data?.find((v) => v.id === versionId);

  useBreadcrumb(`${basePath}/timetables/${versionId}`, version ? `Version ${version.versionNumber}` : null);

  const sections: Entity[] = useMemo(() => {
    const out: Entity[] = [];
    const seen = new Set<string>();
    for (const grade of [...(curriculum.data?.grades ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)) {
      for (const group of grade.curricula) {
        for (const s of group.sections) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          out.push({ id: s.id, label: `${grade.name} · ${s.name}`, group: grade.name });
        }
      }
    }
    return out;
  }, [curriculum.data]);
  const teacherEntities: Entity[] = useMemo(
    () =>
      [...(teachers.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id, label: t.isActive ? t.name : `${t.name} (inactive)`, group: "Teachers" })),
    [teachers.data],
  );
  const entities = viewKind === "section" ? sections : teacherEntities;
  const requestedId = search.get("id");
  const entityId = requestedId ?? entities[0]?.id ?? null;

  const view = useView(versionId, viewKind, entityId);
  const gate = version ? editGate({ versionStatus: version.status, canEditVersions: capabilities.canEditVersions, wideEnough: wide, yearName: year.name }) : null;
  const editing = requestedEdit && gate?.editable === true;
  const editor = useTimetableEditor({ versionId, yearId: year.id, revision: version?.revision });
  const [cloneOpen, setCloneOpen] = useState(false);

  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  if (versionQuery.isPending) return <PageSkeleton />;
  if (versionQuery.isError && !version) {
    return (
      <PageBody>
        <ErrorState error={versionQuery.error} title="Couldn’t load this timetable" onRetry={() => void versionQuery.refetch()} />
      </PageBody>
    );
  }
  if (!version) return null;
  if (version.academicYearId !== year.id) {
    return (
      <PageBody>
        <ErrorState title="Not found" message="This timetable belongs to another academic year." />
      </PageBody>
    );
  }

  const isDraft = version.status === "DRAFT";
  const gridMode: GridMode = editing ? (viewKind === "section" ? "edit-moves" : "edit-locks") : "read";
  const shownLessons: Lesson[] = view.data ? view.data.cells.flatMap((c) => (c.lesson ? [c.lesson] : [])) : [];

  function toggleLock(lesson: Lesson) {
    void editor.perform({ kind: "LOCK", entryIds: [lesson.entryId], locked: !lesson.isLocked });
  }
  function lockAllShown(locked: boolean) {
    if (!version) return;
    const ids = idsToChange(version.entries, shownLessons.map((l) => l.entryId), locked);
    if (ids.length === 0) return;
    void editor.perform({ kind: "LOCK", entryIds: ids, locked });
  }

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href={`${basePath}/timetables`} className="hover:underline">
            Timetables
          </Link>
        }
        title={`Version ${version.versionNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <VersionStatusBadge status={version.status} />
            {summary ? <StaleBadge version={summary} /> : null}
            <span>Revision {version.revision}</span>
            <span aria-hidden>·</span>
            <span>{SOURCE_LABEL[version.solutionSource]}</span>
            <span aria-hidden>·</span>
            <span>{plural(version.entryCount, "lesson")}</span>
            {version.lockedCount > 0 ? <span>· {version.lockedCount} locked</span> : null}
            {version.manualEditCount > 0 ? <span>· {version.manualEditCount} moved by hand</span> : null}
            <span>· created {formatTimestamp(version.createdAt)}</span>
            {version.publishedAt ? <span>· published {formatTimestamp(version.publishedAt)}</span> : null}
          </span>
        }
        actions={
          <>
            {isDraft && capabilities.canEditVersions ? (
              editing || requestedEdit ? (
                <Button variant="outline" onClick={() => setParams({ mode: null })}>
                  <X aria-hidden /> Done editing
                </Button>
              ) : (
                <Button onClick={() => setParams({ mode: "edit" })}>
                  <PencilLine aria-hidden /> Edit timetable
                </Button>
              )
            ) : null}
            {isDraft && capabilities.canGenerate ? (
              <Button asChild variant="outline">
                <Link href={`${basePath}/generate?source=${version.id}`}>
                  <Sparkles aria-hidden /> Regenerate keeping locked lessons
                </Link>
              </Button>
            ) : null}
            {capabilities.canEditVersions ? (
              <Button variant="outline" onClick={() => setCloneOpen(true)}>
                <Copy aria-hidden /> Copy to new draft
              </Button>
            ) : null}
          </>
        }
      />

      {versionQuery.isError ? <StaleDataNotice onRetry={() => void versionQuery.refetch()} /> : null}

      <ValidationSummary
        version={version}
        validation={validation.data}
        error={validation.isError ? validation.error : null}
        isPending={validation.isPending}
        onRetry={() => void validation.refetch()}
      />
      <PublishPanel version={version} validation={validation.data} versions={versions.data} />

      {requestedEdit && gate && !gate.editable ? <ReadOnlyNotice>{gate.reason}</ReadOnlyNotice> : null}

      <section aria-label="Timetable" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" id="view-kind-label">
              Show
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={viewKind}
              aria-labelledby="view-kind-label"
              onValueChange={(v) => v && v !== viewKind && setParams({ view: v, id: null })}
            >
              <ToggleGroupItem value="section">Class</ToggleGroupItem>
              <ToggleGroupItem value="teacher">Teacher</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-72">
            <Label htmlFor="entity-picker">{viewKind === "section" ? "Class" : "Teacher"}</Label>
            <Select value={entityId ?? ""} onValueChange={(id) => setParams({ id })} disabled={entities.length === 0}>
              <SelectTrigger id="entity-picker" className="w-full">
                <SelectValue placeholder={viewKind === "section" ? "Choose a class" : "Choose a teacher"} />
              </SelectTrigger>
              <SelectContent>
                {groupEntities(entities).map(([group, items]) => (
                  <SelectGroup key={group}>
                    {viewKind === "section" ? <SelectLabel>{group}</SelectLabel> : null}
                    {items.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          {editing ? (
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" onClick={() => void editor.undo()} disabled={!editor.canUndo}>
                <Undo2 aria-hidden /> Undo
              </Button>
              <Button variant="outline" size="sm" onClick={() => void editor.redo()} disabled={!editor.canRedo}>
                <Redo2 aria-hidden /> Redo
              </Button>
              <Button variant="outline" size="sm" onClick={() => lockAllShown(true)} disabled={Boolean(editor.pending) || shownLessons.length === 0}>
                <Lock aria-hidden /> Lock all shown
              </Button>
              <Button variant="outline" size="sm" onClick={() => lockAllShown(false)} disabled={Boolean(editor.pending) || shownLessons.length === 0}>
                <LockOpen aria-hidden /> Unlock all shown
              </Button>
            </div>
          ) : null}
        </div>

        {editing ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {viewKind === "section"
              ? "Drag a lesson to an empty slot to move it, or onto another lesson of this class to swap them. Without dragging: select a lesson, choose a slot, then confirm. Each change is saved as soon as the server accepts it. Lessons can only be moved or swapped; teachers change through setup and regeneration."
              : "In the teacher view lessons can be locked or unlocked. Moves and swaps are made in the class view."}
          </p>
        ) : null}

        {editor.notice ? <NoticeBanner notice={editor.notice} onDismiss={editor.dismissNotice} /> : null}

        {!entityId ? (
          curriculum.isPending || teachers.isPending ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <ReadOnlyNotice>{viewKind === "section" ? "This year has no classes to show." : "There are no teachers to show."}</ReadOnlyNotice>
          )
        ) : view.isPending ? (
          <TableSkeleton rows={6} columns={6} />
        ) : view.isError && !view.data ? (
          <ErrorState
            error={view.error}
            title={viewKind === "section" ? "Couldn’t load this class’s timetable" : "Couldn’t load this teacher’s timetable"}
            message={(view.error as { isNotFound?: boolean }).isNotFound ? "It may have been removed. Choose another one above." : undefined}
            onRetry={() => void view.refetch()}
          />
        ) : view.data ? (
          <div className={cn("flex flex-col gap-2", view.isFetching && editor.pending && "opacity-80")}>
            <TimetableGrid
              view={view.data}
              kind={viewKind}
              mode={gridMode}
              entries={version.entries}
              pendingIds={editor.pending?.entryIds ?? []}
              narrow={narrow}
              onDecision={(d) => void editor.perform(d.kind === "SWAP" ? { kind: "SWAP", entryId: d.entryId, swapWithEntryId: d.swapWithEntryId, from: d.from, to: d.to } : d)}
              onToggleLock={toggleLock}
            />
            <TotalsCaption view={view.data} />
          </div>
        ) : null}
      </section>

      {cloneOpen ? <CloneVersionDialog version={version} open onOpenChange={setCloneOpen} /> : null}
    </PageBody>
  );
}

function groupEntities(entities: Entity[]): Array<[string, Entity[]]> {
  const map = new Map<string, Entity[]>();
  for (const e of entities) map.set(e.group, [...(map.get(e.group) ?? []), e]);
  return [...map.entries()];
}

/** P4: a caption on the single grid being viewed. No cross-teacher comparison. */
function TotalsCaption({ view }: { view: TimetableView }) {
  const t = view.totals;
  return (
    <p className="text-xs text-muted-foreground" data-testid="totals">
      {plural(t.lessons, "lesson")} · {plural(t.freeSlots, "free slot")}
      {t.lockedLessons > 0 ? ` · ${t.lockedLessons} locked` : ""}
      {t.manualLessons > 0 ? ` · ${t.manualLessons} moved by hand` : ""}
      {t.outsideGrid > 0 ? ` · ${plural(t.outsideGrid, "lesson")} outside the current grid (not shown)` : ""}
    </p>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: EditorNotice; onDismiss: () => void }) {
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm",
        notice.tone === "error" && "border-destructive/30 bg-destructive-muted",
        notice.tone === "info" && "border-info/20 bg-info-muted",
        notice.tone === "success" && "border-success/20 bg-success-muted",
      )}
      data-testid="editor-notice"
    >
      <CircleAlert className={cn("mt-0.5 size-4 shrink-0", notice.tone === "error" ? "text-destructive" : "text-muted-foreground")} aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{notice.title}</p>
        {notice.description ? <p className="text-muted-foreground">{notice.description}</p> : null}
        {notice.items?.length ? (
          <ul className="list-disc pl-5">
            {notice.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : null}
        {notice.action ? (
          <Button size="sm" variant="outline" className="mt-1" onClick={notice.action.run}>
            {notice.action.label}
          </Button>
        ) : null}
      </div>
      <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Dismiss message">
        <X aria-hidden />
      </Button>
    </div>
  );
}

