"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MoreHorizontal, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { matchesQuery, SearchInput, Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, NoResults, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useYear } from "@/features/academic-years/year-context";
import type { TeacherListItem } from "@/lib/api/types";
import { BulkTeachersDialog } from "./bulk-teachers-dialog";
import { useTeachers } from "./hooks";
import { LINK_TYPE_LABEL, matchesStatus, type StatusFilter } from "./rules";
import { useTeacherActions } from "./teacher-actions";
import { TeacherFormDialog } from "./teacher-form-dialog";

export function TeachersPage() {
  const { year, basePath } = useYear();
  const teachers = useTeachers();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { open: openAction, dialogs: actionDialogs } = useTeacherActions(year.id);

  const rows = useMemo(
    () =>
      (teachers.data ?? []).filter(
        (t) => matchesStatus(t, status) && matchesQuery(query, t.name, t.employeeCode, ...t.subjects.flatMap((s) => [s.name, s.code])),
      ),
    [teachers.data, status, query],
  );

  const columns = useMemo<DataColumn<TeacherListItem>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        sortValue: (t) => t.name.toLowerCase(),
        cell: (t) => (
          <Link href={`${basePath}/teachers/${t.id}`} className="font-medium text-foreground hover:text-primary hover:underline">
            {t.name}
          </Link>
        ),
      },
      {
        id: "code",
        header: "Employee code",
        sortValue: (t) => t.employeeCode ?? "",
        cell: (t) => (t.employeeCode ? <span className="font-mono text-xs">{t.employeeCode}</span> : <span className="text-muted-foreground">None</span>),
        hideOnMobile: true,
      },
      {
        id: "status",
        header: "Status",
        sortValue: (t) => (t.isActive ? 0 : 1),
        cell: (t) => (t.isActive ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>),
      },
      {
        id: "subjects",
        header: "Subjects",
        cell: (t) =>
          t.subjects.length === 0 ? (
            <span className="text-muted-foreground">No subjects yet</span>
          ) : (
            <ul className="flex flex-wrap gap-1" aria-label={`${t.name}’s subjects`}>
              {t.subjects.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs">
                  {s.name}
                  <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase" title={LINK_TYPE_LABEL[s.type]}>
                    {LINK_TYPE_LABEL[s.type]}
                  </span>
                </li>
              ))}
            </ul>
          ),
        hideOnMobile: true,
      },
      {
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (t) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`${basePath}/teachers/${t.id}`}>Open</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction({ kind: "edit", teacher: t })}>Edit</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction({ kind: "status", teacher: t })}>{t.isActive ? "Deactivate" : "Reactivate"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => openAction({ kind: "delete", teacher: t })}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [basePath, openAction],
  );

  const headerActions = (
    <>
      <Button variant="outline" onClick={() => setBulkOpen(true)}>
        Add several
      </Button>
      <Button onClick={() => setCreateOpen(true)}>
        <Plus /> Add teacher
      </Button>
    </>
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow={year.name}
        title="Teachers"
        description="Teachers are shared by every academic year. Open a teacher to set the subjects they can teach and the grades they are eligible for in this year."
        actions={headerActions}
      />

      {teachers.isPending ? (
        <TableSkeleton columns={4} />
      ) : teachers.isError && !teachers.data ? (
        <ErrorState error={teachers.error} title="Couldn’t load teachers" onRetry={() => void teachers.refetch()} />
      ) : (teachers.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No teachers yet"
          description="Add the school’s teachers, then open each one to set their subjects and grade eligibility."
          action={headerActions}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {teachers.isError ? <StaleDataNotice onRetry={() => void teachers.refetch()} /> : null}
          <Toolbar>
            <SearchInput value={query} onChange={setQuery} placeholder="Search name, code or subject" label="Search teachers" />
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Show teachers">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">All teachers</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground sm:ml-auto tabular">
              {rows.length} of {teachers.data?.length ?? 0}
            </span>
          </Toolbar>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(t) => t.id}
            caption="Teachers"
            initialSort={{ id: "name" }}
            dense
            empty={
              <NoResults
                query={query || undefined}
                onClear={() => {
                  setQuery("");
                  setStatus("all");
                }}
              />
            }
          />
        </div>
      )}

      <TeacherFormDialog open={createOpen} onOpenChange={setCreateOpen} yearId={year.id} />
      <BulkTeachersDialog open={bulkOpen} onOpenChange={setBulkOpen} yearId={year.id} />
      {actionDialogs}
    </PageBody>
  );
}
