"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, CalendarDays, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { DetailList, Panel } from "@/components/shared/stat-card";
import { EmptyState, ErrorState, PageSkeleton, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { useBreadcrumb } from "@/components/layout/breadcrumbs";
import { useYear } from "@/features/academic-years/year-context";
import { sectionLabel } from "@/lib/format";
import type { SectionAssignment } from "@/lib/api/types";
import { useTeacher, useTeacherYearAssignments } from "./hooks";
import { SubjectEligibilitySection } from "./subject-eligibility-section";
import { useTeacherActions } from "./teacher-actions";

export function TeacherDetailPage({ teacherId }: { teacherId: string }) {
  const { year, basePath } = useYear();
  const pathname = usePathname();
  const router = useRouter();
  const teacher = useTeacher(teacherId);
  const { open: openAction, dialogs } = useTeacherActions(year.id, { onDeleted: () => router.replace(`${basePath}/teachers`) });
  useBreadcrumb(pathname, teacher.data?.name);

  if (teacher.isPending) return <PageSkeleton />;
  if (teacher.isError && !teacher.data) {
    return (
      <PageBody>
        <ErrorState error={teacher.error} title="Couldn’t load this teacher" onRetry={() => void teacher.refetch()} />
        <div>
          <Button variant="outline" asChild>
            <Link href={`${basePath}/teachers`}>
              <ArrowLeft /> All teachers
            </Link>
          </Button>
        </div>
      </PageBody>
    );
  }
  const t = teacher.data;

  return (
    <PageBody>
      <PageHeader
        eyebrow={
          <Link href={`${basePath}/teachers`} className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3" aria-hidden /> Teachers
          </Link>
        }
        title={t.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t.isActive ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}
            {t.employeeCode ? <span className="font-mono text-xs">{t.employeeCode}</span> : <span>No employee code</span>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => openAction({ kind: "edit", teacher: t })}>
              Edit
            </Button>
            <Button variant="outline" onClick={() => openAction({ kind: "status", teacher: t })}>
              {t.isActive ? "Deactivate" : "Reactivate"}
            </Button>
            <Button variant="destructive" onClick={() => openAction({ kind: "delete", teacher: t })}>
              Delete
            </Button>
          </>
        }
      />
      {teacher.isError ? <StaleDataNotice onRetry={() => void teacher.refetch()} /> : null}

      {!t.isActive ? (
        <div role="status" className="rounded-xl border border-warning/30 bg-warning-muted px-3.5 py-2.5 text-sm text-warning-foreground">
          This teacher is inactive: they can’t be pinned to classes and the generator never chooses them. Generating a timetable is refused while they are still
          pinned to a class.
        </div>
      ) : null}

      <Panel>
        <DetailList
          items={[
            { label: "Name", value: t.name },
            { label: "Employee code", value: t.employeeCode ?? <span className="text-muted-foreground">None</span> },
            { label: "Status", value: t.isActive ? "Active" : "Inactive" },
            {
              label: "Timetable",
              value: (
                <Link href={`${basePath}/timetables`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <CalendarDays className="size-3.5" aria-hidden /> View timetables
                </Link>
              ),
            },
          ]}
        />
      </Panel>

      <SubjectEligibilitySection teacher={t} />
      <TeacherPinsSection teacherId={t.id} teacherName={t.name} />
      {dialogs}
    </PageBody>
  );
}

function TeacherPinsSection({ teacherId, teacherName }: { teacherId: string; teacherName: string }) {
  const { year, basePath } = useYear();
  const pins = useTeacherYearAssignments(year.id, teacherId);
  const rows = useMemo(
    () =>
      [...(pins.data ?? [])].sort(
        (a, b) => a.grade.displayOrder - b.grade.displayOrder || a.section.name.localeCompare(b.section.name) || a.subject.name.localeCompare(b.subject.name),
      ),
    [pins.data],
  );
  const columns = useMemo<DataColumn<SectionAssignment>[]>(
    () => [
      {
        id: "class",
        header: "Class",
        sortValue: (a) => `${String(a.grade.displayOrder).padStart(4, "0")} ${a.section.name}`,
        cell: (a) => (
          <span className="font-medium">
            {sectionLabel(a.grade.name, a.section.name)}
            {a.stream ? <span className="ml-1 text-xs font-normal text-muted-foreground">({a.stream.name})</span> : null}
          </span>
        ),
      },
      { id: "subject", header: "Subject", sortValue: (a) => a.subject.name, cell: (a) => a.subject.name },
      {
        id: "periods",
        header: "Periods per week",
        align: "right",
        sortValue: (a) => a.subjectRequirement.periodsPerWeek,
        cell: (a) => <span className="tabular">{a.subjectRequirement.periodsPerWeek}</span>,
      },
    ],
    [],
  );

  const link = (
    <Button variant="outline" size="sm" asChild>
      <Link href={`${basePath}/assignments`}>Open assignments</Link>
    </Button>
  );

  return (
    <Section
      id="pins"
      title={`Pinned classes in ${year.name}`}
      description="Optional pins fix this teacher for a class and subject. Everything else is chosen automatically from eligible teachers at generation."
      actions={link}
    >
      {pins.isPending ? (
        <TableSkeleton rows={2} columns={3} />
      ) : pins.isError && !pins.data ? (
        <ErrorState compact error={pins.error} title="Couldn’t load pinned classes" onRetry={() => void pins.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<Pin className="size-5" />}
          title="Not pinned to any class"
          description={`The generator may still choose ${teacherName} for any class they are eligible for.`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {pins.isError ? <StaleDataNotice onRetry={() => void pins.refetch()} /> : null}
          <DataTable data={rows} columns={columns} getRowId={(a) => a.id} caption={`${teacherName}’s pinned classes`} dense pageSize={50} />
        </div>
      )}
    </Section>
  );
}
