"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { MoreHorizontal, Plus, UserMinus } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, NoResults, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Absence } from "@/lib/api/schemas";
import { formatDateRange, isIsoDate } from "@/lib/dates";
import { absenceScopeLabel } from "../board-rules";
import { useAbsences, useTeachers, type AbsenceFilters } from "../hooks";
import { AbsenceFormSheet } from "./absence-form-sheet";
import { CancelAbsenceDialog } from "./cancel-absence-dialog";

const ALL = "all";

export function AbsencesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"ACTIVE" | "CANCELLED">("ACTIVE");
  const [teacherId, setTeacherId] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formOpen, setFormOpen] = useState(searchParams.get("new") === "1");
  const [editing, setEditing] = useState<Absence | null>(null);
  const [cancelling, setCancelling] = useState<Absence | null>(null);

  const filters: AbsenceFilters = {
    status,
    teacherId: teacherId === ALL ? undefined : teacherId,
    from: isIsoDate(from) ? from : undefined,
    to: isIsoDate(to) ? to : undefined,
  };
  const absences = useAbsences(filters);
  const teachers = useTeachers();
  const teacherList = useMemo(() => teachers.data ?? [], [teachers.data]);
  const names = useMemo(() => new Map(teacherList.map((t) => [t.id, t.name])), [teacherList]);
  const nameOf = (a: Absence) => a.teacher?.name ?? names.get(a.teacherId) ?? "Teacher";
  const filtered = teacherId !== ALL || from !== "" || to !== "";

  function closeForm(open: boolean) {
    if (open) return;
    setFormOpen(false);
    setEditing(null);
    if (searchParams.get("new")) router.replace(pathname, { scroll: false });
  }

  const columns: DataColumn<Absence>[] = [
    {
      id: "teacher",
      header: "Teacher",
      cell: (a) => (
        <Link href={`/operations/absences/${a.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
          {nameOf(a)}
        </Link>
      ),
      sortValue: (a) => nameOf(a),
    },
    { id: "dates", header: "Dates", cell: (a) => <span className="whitespace-nowrap">{formatDateRange(a.startDate, a.endDate)}</span>, sortValue: (a) => a.startDate },
    { id: "scope", header: "Scope", cell: (a) => <span className="whitespace-nowrap">{absenceScopeLabel(a)}</span> },
    { id: "reason", header: "Reason", cell: (a) => <span className="line-clamp-2 text-muted-foreground">{a.reason ?? "—"}</span>, hideOnMobile: true },
    { id: "covers", header: "Covers", cell: (a) => <CoverCounts absence={a} /> },
    { id: "status", header: "Status", cell: (a) => <AbsenceStatus absence={a} /> },
    { id: "actions", header: <span className="sr-only">Actions</span>, cell: (a) => <RowActions absence={a} name={nameOf(a)} onEdit={setEditing} onCancel={setCancelling} />, align: "right" },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Absences"
        description="Teacher absences and the lessons they leave without a teacher. Recording one creates the lessons that need cover from the published timetable."
        actions={
          <Button onClick={() => setFormOpen(true)} disabled={!teachers.data}>
            <Plus aria-hidden /> Record absence
          </Button>
        }
      />

      <Toolbar>
        <div className="space-y-1">
          <Label htmlFor="absence-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "CANCELLED")}>
            <SelectTrigger id="absence-status" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="absence-teacher" className="text-xs text-muted-foreground">
            Teacher
          </Label>
          <Select value={teacherId} onValueChange={setTeacherId}>
            <SelectTrigger id="absence-teacher" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All teachers</SelectItem>
              {[...teacherList]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="absence-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input id="absence-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="absence-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="absence-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" />
        </div>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start sm:mt-5 sm:self-center"
            onClick={() => {
              setTeacherId(ALL);
              setFrom("");
              setTo("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </Toolbar>

      {absences.isPending ? (
        <TableSkeleton rows={6} columns={6} />
      ) : absences.isError && !absences.data ? (
        <ErrorState error={absences.error} title="Couldn’t load absences" onRetry={() => void absences.refetch()} />
      ) : (
        <>
          {absences.isRefetchError ? <StaleDataNotice onRetry={() => void absences.refetch()} /> : null}
          {absences.data.length === 0 ? (
            filtered ? (
              <NoResults onClear={() => { setTeacherId(ALL); setFrom(""); setTo(""); }} />
            ) : (
              <EmptyState
                icon={<UserMinus className="size-5" />}
                title={status === "ACTIVE" ? "No active absences" : "No cancelled absences"}
                description={status === "ACTIVE" ? "Record an absence when a teacher will be away. Their lessons will appear on the daily cover board." : undefined}
                action={status === "ACTIVE" ? <Button size="sm" onClick={() => setFormOpen(true)} disabled={!teachers.data}>Record absence</Button> : null}
              />
            )
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable data={absences.data} columns={columns} getRowId={(a) => a.id} caption="Absences" dense />
              </div>
              <ul className="space-y-2 md:hidden" aria-label="Absences">
                {absences.data.map((a) => (
                  <li key={a.id} className="space-y-2 rounded-lg border bg-surface p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/operations/absences/${a.id}`} className="font-medium text-foreground hover:underline">
                          {nameOf(a)}
                        </Link>
                        <p className="text-muted-foreground">
                          {formatDateRange(a.startDate, a.endDate)} · {absenceScopeLabel(a)}
                        </p>
                      </div>
                      <RowActions absence={a} name={nameOf(a)} onEdit={setEditing} onCancel={setCancelling} />
                    </div>
                    {a.reason ? <p className="text-muted-foreground">{a.reason}</p> : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <AbsenceStatus absence={a} />
                      <CoverCounts absence={a} />
                    </div>
                  </li>
                ))}
              </ul>
              {absences.data.length >= 500 ? <p className="text-xs text-muted-foreground">Showing the first 500 absences. Narrow the dates to see others.</p> : null}
            </>
          )}
        </>
      )}

      <AbsenceFormSheet open={formOpen || editing !== null} onOpenChange={closeForm} absence={editing} teachers={teacherList} />
      <CancelAbsenceDialog absence={cancelling} teacherName={cancelling ? nameOf(cancelling) : ""} onOpenChange={(open) => (!open ? setCancelling(null) : undefined)} />
    </PageBody>
  );
}

function AbsenceStatus({ absence }: { absence: Absence }) {
  return absence.status === "ACTIVE" ? <StatusBadge tone="info">Active</StatusBadge> : <StatusBadge tone="neutral">Cancelled</StatusBadge>;
}

function CoverCounts({ absence }: { absence: Absence }) {
  const c = absence.covers;
  if (!c) return <span className="text-muted-foreground">—</span>;
  if (c.OPEN === 0 && c.ASSIGNED === 0) return <span className="text-xs text-muted-foreground">No lessons need cover</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {c.OPEN > 0 ? <StatusBadge tone="warning">{c.OPEN} need cover</StatusBadge> : null}
      {c.ASSIGNED > 0 ? <StatusBadge tone="success">{c.ASSIGNED} assigned</StatusBadge> : null}
    </span>
  );
}

function RowActions({ absence, name, onEdit, onCancel }: { absence: Absence; name: string; onEdit: (a: Absence) => void; onCancel: (a: Absence) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}’s absence`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/operations/absences/${absence.id}`}>View details</Link>
        </DropdownMenuItem>
        {absence.status === "ACTIVE" ? (
          <>
            <DropdownMenuItem onSelect={() => onEdit(absence)}>Edit absence</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => onCancel(absence)}>
              Cancel absence
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
