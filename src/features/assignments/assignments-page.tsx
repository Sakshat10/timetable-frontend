"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, LayoutGrid, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, NoResults, ReadOnlyNotice, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { useYear } from "@/features/academic-years/year-context";
import { useTeachers } from "@/features/teachers/hooks";
import { cn } from "@/lib/utils";
import type { SectionAssignment } from "@/lib/api/types";
import { useCurriculumOverview, useYearAssignments } from "./hooks";
import { PinDialog, type PinTarget } from "./pin-dialog";
import { buildGrid, filterGrid, indexPins, pinCounts, pinKey, type GridFilters, type GridGroup } from "./rules";

const ALL = "all";

export function AssignmentsPage() {
  const { year, basePath, capabilities } = useYear();
  const overview = useCurriculumOverview(year.id);
  const pins = useYearAssignments(year.id);
  const teachers = useTeachers();
  const [filters, setFilters] = useState<GridFilters>({ gradeId: null, subjectId: null, teacherId: null, pinnedOnly: false });
  const [target, setTarget] = useState<PinTarget | null>(null);

  const grid = useMemo(() => buildGrid(overview.data), [overview.data]);
  const pinIndex = useMemo(() => indexPins(pins.data), [pins.data]);
  const visible = useMemo(() => filterGrid(grid, pinIndex, filters), [grid, pinIndex, filters]);
  const counts = useMemo(() => pinCounts(grid, pinIndex), [grid, pinIndex]);
  const inactivePins = useMemo(() => (pins.data ?? []).filter((p) => !p.teacher.isActive), [pins.data]);

  const gradeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of grid) seen.set(g.gradeId, g.gradeName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [grid]);
  const subjectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of grid) for (const r of g.requirements) seen.set(r.subjectId, r.subjectName);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [grid]);
  const teacherOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of pins.data ?? []) seen.set(p.teacherId, p.teacher.name);
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [pins.data]);

  const filtered = filters.gradeId !== null || filters.subjectId !== null || filters.teacherId !== null || filters.pinnedOnly;
  const loading = overview.isPending || pins.isPending;
  const loadError = (overview.isError && !overview.data) || (pins.isError && !pins.data);
  const stale = (overview.isError && overview.data) || (pins.isError && pins.data) || (teachers.isError && teachers.data);
  const retry = () => {
    void overview.refetch();
    void pins.refetch();
    void teachers.refetch();
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow={year.name}
        title="Assignments"
        description="Optional: pin a specific teacher to a class and subject. Every cell left on “Automatic” is filled at generation by an eligible teacher, and that choice is not stored here."
      />

      {!capabilities.canEditSetup && capabilities.setupLockedReason ? (
        <ReadOnlyNotice>{capabilities.setupLockedReason} Pins can be viewed but not changed.</ReadOnlyNotice>
      ) : null}

      {loading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : loadError ? (
        <ErrorState error={overview.error ?? pins.error} title="Couldn’t load assignments" onRetry={retry} />
      ) : grid.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="size-5" />}
          title="No subjects to pin yet"
          description={`Pins are made per class and subject. Add classes and a curriculum for ${year.name} first.`}
          action={
            <>
              <Button variant="outline" asChild>
                <Link href={`${basePath}/classes`}>Classes</Link>
              </Button>
              <Button asChild>
                <Link href={`${basePath}/curriculum`}>Curriculum</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {stale ? <StaleDataNotice onRetry={retry} /> : null}
          {inactivePins.length > 0 ? (
            <div role="status" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-2.5 text-sm text-warning-foreground dark:text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                {inactivePins.length === 1 ? "1 pin uses an inactive teacher" : `${inactivePins.length} pins use inactive teachers`}:{" "}
                {[...new Set(inactivePins.map((p) => p.teacher.name))].join(", ")}. Generation is refused until these pins are changed or the teachers are reactivated.
              </div>
            </div>
          ) : null}

          <Toolbar>
            <FilterSelect label="Grade" value={filters.gradeId} allLabel="All grades" options={gradeOptions} onChange={(gradeId) => setFilters((f) => ({ ...f, gradeId }))} />
            <FilterSelect label="Subject" value={filters.subjectId} allLabel="All subjects" options={subjectOptions} onChange={(subjectId) => setFilters((f) => ({ ...f, subjectId }))} />
            <FilterSelect
              label="Pinned teacher"
              value={filters.teacherId}
              allLabel="Any teacher"
              options={teacherOptions}
              onChange={(teacherId) => setFilters((f) => ({ ...f, teacherId }))}
            />
            <div className="flex items-center gap-2">
              <Checkbox id="pinned-only" checked={filters.pinnedOnly} onCheckedChange={(v) => setFilters((f) => ({ ...f, pinnedOnly: v === true }))} />
              <Label htmlFor="pinned-only" className="font-normal">
                Pinned only
              </Label>
            </div>
            <span className="text-xs text-muted-foreground sm:ml-auto tabular">
              {counts.pinned} of {counts.cells} class subjects pinned
            </span>
          </Toolbar>

          {visible.length === 0 ? (
            <NoResults onClear={filtered ? () => setFilters({ gradeId: null, subjectId: null, teacherId: null, pinnedOnly: false }) : undefined} />
          ) : (
            visible.map((group) => (
              <GroupGrid
                key={group.key}
                group={group}
                pins={pinIndex}
                highlightTeacherId={filters.teacherId}
                canEdit={capabilities.canEditSetup}
                onOpen={(requirement, section, pin) => setTarget({ group, requirement, section, pin })}
              />
            ))
          )}
        </div>
      )}

      <PinDialog target={target} onOpenChange={(open) => (!open ? setTarget(null) : undefined)} teachers={teachers.data ?? []} />
    </PageBody>
  );
}

function FilterSelect({
  label,
  value,
  allLabel,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | null) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className="w-full sm:w-44" aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GroupGrid({
  group,
  pins,
  highlightTeacherId,
  canEdit,
  onOpen,
}: {
  group: GridGroup;
  pins: ReadonlyMap<string, SectionAssignment>;
  highlightTeacherId: string | null;
  canEdit: boolean;
  onOpen: (requirement: GridGroup["requirements"][number], section: GridGroup["sections"][number], pin: SectionAssignment | null) => void;
}) {
  const headingId = `group-${group.key.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <Section id={headingId} title={group.label} description={group.sections.length === 0 ? "This curriculum has no sections yet." : undefined}>
      {group.sections.length > 0 ? (
        <div className="overflow-hidden rounded-lg border bg-surface">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Pinned teachers for {group.label}</caption>
              <thead className="bg-muted/50">
                <tr className="border-b">
                  <th scope="col" className="sticky left-0 z-10 h-10 min-w-40 bg-muted px-3 pl-4 text-left text-xs font-medium text-muted-foreground">
                    Subject
                  </th>
                  {group.sections.map((s) => (
                    <th key={s.id} scope="col" className="h-10 min-w-44 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.requirements.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 pl-4 text-left font-normal">
                      <div className="font-medium text-foreground">{r.subjectName}</div>
                      <div className="text-xs text-muted-foreground tabular">{r.periodsPerWeek} per week</div>
                    </th>
                    {group.sections.map((s) => {
                      if (!r.sectionIds.has(s.id)) {
                        return (
                          <td key={s.id} className="px-3 py-2 text-xs text-muted-foreground">
                            <span aria-hidden>—</span>
                            <span className="sr-only">Not taught in {s.name}</span>
                          </td>
                        );
                      }
                      const pin = pins.get(pinKey(s.id, r.id)) ?? null;
                      const dim = highlightTeacherId !== null && pin?.teacherId !== highlightTeacherId;
                      const label = pin
                        ? `${r.subjectName}, ${s.name}: pinned to ${pin.teacher.name}${pin.teacher.isActive ? "" : " (inactive)"}`
                        : `${r.subjectName}, ${s.name}: automatic`;
                      const content = pin ? (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Pin className="size-3.5 shrink-0 text-primary" aria-hidden />
                          <span className="truncate font-medium text-foreground">{pin.teacher.name}</span>
                          {!pin.teacher.isActive ? (
                            <span className="shrink-0 rounded border border-warning/40 bg-warning-muted px-1 text-[0.65rem] font-medium text-warning-foreground dark:text-warning">
                              Inactive
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Automatic</span>
                      );
                      return (
                        <td key={s.id} className={cn("px-2 py-1.5", dim && "opacity-40")}>
                          {canEdit ? (
                            <button
                              type="button"
                              aria-label={`${label}. ${pin ? "Edit pin" : "Pin a teacher"}`}
                              onClick={() => onOpen(r, s, pin)}
                              className={cn(
                                "flex w-full items-center rounded-md border px-2 py-1.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                                pin ? "border-border bg-background" : "border-dashed border-border/80",
                              )}
                            >
                              {content}
                            </button>
                          ) : (
                            <div className="flex px-2 py-1.5">
                              {content}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
