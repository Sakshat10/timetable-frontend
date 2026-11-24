"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { CalendarCheck2, Sparkles, UserMinus } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CardsSkeleton, EmptyState, ErrorState, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Cover } from "@/lib/api/schemas";
import { todayUtc } from "@/lib/dates";
import { sectionLabel } from "@/lib/format";
import { coverCounts, groupCovers, relationToToday, resolveBoardDate, type GroupBy } from "../board-rules";
import { useDayCovers, useGradeNames } from "../hooks";
import { AutoAssignDialog } from "./auto-assign-dialog";
import { AttentionNote, CoverStatusBadge, SourceBadge, TemporaryCoverBadge } from "./cover-badges";
import { CoverSheet } from "./cover-sheet";
import { DateNavigator } from "./date-navigator";

/** "Daily cover": the lessons that need a substitute on one UTC calendar date (PHASE-0-AUDIT §6.1). */
export function DailyBoard() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = todayUtc();
  const date = resolveBoardDate(searchParams.get("date"), today);
  const coverId = searchParams.get("cover");
  const [groupBy, setGroupBy] = useState<GroupBy>("period");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const covers = useDayCovers(date, includeClosed);
  const gradeNames = useGradeNames(date);
  const switchId = useId();
  const relation = relationToToday(date, today);

  function navigate(next: { date?: string; cover?: string | null }, mode: "push" | "replace") {
    const params = new URLSearchParams(searchParams.toString());
    if (next.date !== undefined) params.set("date", next.date);
    if (next.cover === null) params.delete("cover");
    else if (next.cover !== undefined) params.set("cover", next.cover);
    const href = `${pathname}?${params.toString()}`;
    if (mode === "push") router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  }

  const items = covers.data?.items ?? [];
  const counts = coverCounts(items);
  const groups = groupCovers(items, groupBy);

  return (
    <PageBody>
      <PageHeader
        title="Daily cover"
        description="Lessons that need a substitute on one day, from the published timetable of the academic year that contains the date."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/operations/absences?new=1">
                <UserMinus aria-hidden /> Record absence
              </Link>
            </Button>
            <Button onClick={() => setAutoOpen(true)}>
              <Sparkles aria-hidden /> Assign automatically
            </Button>
          </>
        }
      />

      <DateNavigator date={date} today={today} onChange={(d) => navigate({ date: d, cover: null }, "push")} />

      {covers.isPending ? (
        <>
          <CardsSkeleton count={4} />
          <TableSkeleton rows={5} columns={5} />
        </>
      ) : covers.isError && !covers.data ? (
        <ErrorState error={covers.error} title="Couldn’t load the lessons for this date" onRetry={() => void covers.refetch()} />
      ) : (
        <>
          {covers.isRefetchError ? <StaleDataNotice onRetry={() => void covers.refetch()} /> : null}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatCard label="Lessons needing cover" value={counts.total} />
            <StatCard label="Assigned" value={counts.assigned} tone={counts.assigned > 0 ? "success" : "default"} />
            <StatCard label="Still need cover" value={counts.open} tone={counts.open > 0 ? "warning" : "default"} />
            <StatCard label="Need attention" value={counts.attention} tone={counts.attention > 0 ? "warning" : "default"} hint={counts.temporary > 0 ? `${counts.temporary} temporary (unqualified) cover` : undefined} />
          </div>

          <Section
            title="Lessons"
            id="board-lessons"
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch id={switchId} checked={includeClosed} onCheckedChange={setIncludeClosed} />
                  <Label htmlFor={switchId} className="text-sm font-normal">
                    Show cancelled and obsolete
                  </Label>
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={groupBy}
                  onValueChange={(value) => (value ? setGroupBy(value as GroupBy) : undefined)}
                  aria-label="Group lessons by"
                >
                  <ToggleGroupItem value="period">By period</ToggleGroupItem>
                  <ToggleGroupItem value="teacher">By absent teacher</ToggleGroupItem>
                </ToggleGroup>
              </div>
            }
          >
            {items.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck2 className="size-5" />}
                title="No lessons need cover on this date"
                description={
                  relation === "past"
                    ? "Nothing was recorded for this day."
                    : "When a teacher is absent, their lessons from the published timetable appear here. Record an absence to start."
                }
                action={
                  <Button asChild size="sm">
                    <Link href="/operations/absences?new=1">Record absence</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-4">
                {covers.data && covers.data.total > items.length ? (
                  <p className="text-xs text-muted-foreground">
                    Showing {items.length} of {covers.data.total} lessons.
                  </p>
                ) : null}
                {groups.map((group) => (
                  <CoverGroupView key={group.key} label={group.label} items={group.items} gradeNames={gradeNames} onOpen={(id) => navigate({ cover: id }, "replace")} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <AutoAssignDialog open={autoOpen} onOpenChange={setAutoOpen} date={date} isPast={relation === "past"} />
      <CoverSheet coverId={coverId} onClose={() => navigate({ cover: null }, "replace")} gradeNames={gradeNames} />
    </PageBody>
  );
}

function CoverGroupView({ label, items, gradeNames, onOpen }: { label: string; items: Cover[]; gradeNames: Map<string, string>; onOpen: (id: string) => void }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border bg-surface shadow-card">
      <h3 id={id} className="flex items-center justify-between border-b bg-muted/50 px-4 py-2 text-sm font-semibold text-foreground">
        <span>{label}</span>
        <span className="tabular text-xs font-normal text-muted-foreground">
          {items.length} {items.length === 1 ? "lesson" : "lessons"}
        </span>
      </h3>
      <ul className="divide-y">
        {items.map((cover) => (
          <CoverRow key={cover.id} cover={cover} classLabel={sectionLabel(gradeNames.get(cover.section.gradeId), cover.section.name)} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

function CoverRow({ cover, classLabel, onOpen }: { cover: Cover; classLabel: string; onOpen: (id: string) => void }) {
  const live = cover.status === "OPEN" || cover.status === "ASSIGNED";
  const action = cover.status === "OPEN" ? "Find substitute" : cover.status === "ASSIGNED" ? "Manage" : "View";
  return (
    <li
      data-testid="cover-row"
      className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[3rem_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4"
    >
      <div className="flex items-center gap-2 md:block">
        <span className="tabular inline-flex h-6 min-w-9 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold text-foreground">P{cover.periodNumber}</span>
        <span className="font-medium text-foreground md:hidden">
          {classLabel} · {cover.subject.name}
        </span>
      </div>
      <div className="hidden min-w-0 md:block">
        <p className="truncate font-medium text-foreground">{classLabel}</p>
        <p className="truncate text-xs text-muted-foreground">{cover.subject.name}</p>
      </div>
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground md:hidden">Absent: </span>
        <span className="text-foreground">{cover.absentTeacher.name}</span>
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {cover.status === "ASSIGNED" && cover.replacementTeacher ? (
            <span className="font-medium text-foreground">
              <span className="text-xs font-normal text-muted-foreground">Substitute: </span>
              {cover.replacementTeacher.name}
            </span>
          ) : live ? (
            <StatusBadge tone="warning">Needs cover</StatusBadge>
          ) : (
            <CoverStatusBadge status={cover.status} />
          )}
          {cover.status === "ASSIGNED" ? <SourceBadge source={cover.assignmentSource} /> : null}
          {cover.status === "ASSIGNED" && cover.temporaryUnqualified ? <TemporaryCoverBadge /> : null}
        </div>
        {live ? <AttentionNote attention={cover.attention} /> : null}
      </div>
      <div className="md:text-right">
        <Button
          size="sm"
          variant={cover.status === "OPEN" ? "default" : "outline"}
          className="w-full md:w-auto"
          aria-label={`${action}: period ${cover.periodNumber}, ${classLabel}, ${cover.subject.name}`}
          onClick={() => onOpen(cover.id)}
        >
          {action}
        </Button>
      </div>
    </li>
  );
}
