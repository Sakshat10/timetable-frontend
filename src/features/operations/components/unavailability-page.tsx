"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarOff, Plus } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { ConfirmDialog, PendingButton } from "@/components/shared/confirm-dialog";
import { applyServerErrors, CheckboxField, FormAlert, NumberField, SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { Toolbar } from "@/components/shared/search-input";
import { EmptyState, ErrorState, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isApiError } from "@/lib/api/errors";
import type { Unavailability } from "@/lib/api/schemas";
import type { TeacherListItem } from "@/lib/api/types";
import { formatDate, isIsoDate, todayUtc } from "@/lib/dates";
import { notifyError, notifySuccess } from "@/lib/notify";
import { toCreateUnavailabilityBody, UNAVAILABILITY_FORM_FIELDS, unavailabilityFormSchema, type UnavailabilityFormValues } from "../absence-form";
import { lessonsFromDetails } from "../board-rules";
import { useCancelUnavailability, useCreateUnavailability, useTeachers, useUnavailability } from "../hooks";
import { AllocationNotice } from "./allocation-notice";
import { RefusalWithLessons } from "./cover-badges";

const periodText = (u: Unavailability) => (u.wholeDay || u.periodNumber == null ? "Whole day" : `Period ${u.periodNumber}`);

/** Teacher unavailability: periods a teacher can't be given as a substitute (they keep their own lessons). */
export function UnavailabilityPage() {
  const [status, setStatus] = useState<"ACTIVE" | "CANCELLED">("ACTIVE");
  const [from, setFrom] = useState(todayUtc());
  const [to, setTo] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelling, setCancelling] = useState<Unavailability | null>(null);
  const list = useUnavailability({ status, from: isIsoDate(from) ? from : undefined, to: isIsoDate(to) ? to : undefined });
  const teachers = useTeachers();
  const teacherList = useMemo(() => teachers.data ?? [], [teachers.data]);
  const names = useMemo(() => new Map(teacherList.map((t) => [t.id, t.name])), [teacherList]);
  const nameOf = (u: Unavailability) => names.get(u.teacherId) ?? (teachers.isPending ? "…" : "Unknown teacher");
  const cancel = useCancelUnavailability();

  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.date.localeCompare(b.date) || (a.periodNumber ?? 0) - (b.periodNumber ?? 0)), [list.data]);

  const columns: DataColumn<Unavailability>[] = [
    { id: "teacher", header: "Teacher", cell: (u) => <span className="font-medium text-foreground">{nameOf(u)}</span>, sortValue: (u) => nameOf(u) },
    { id: "date", header: "Date", cell: (u) => <span className="whitespace-nowrap">{formatDate(u.date)}</span>, sortValue: (u) => u.date },
    { id: "period", header: "Period", cell: periodText, sortValue: (u) => u.periodNumber ?? 0 },
    { id: "reason", header: "Reason", cell: (u) => <span className="text-muted-foreground">{u.reason ?? "—"}</span>, hideOnMobile: true },
    { id: "status", header: "Status", cell: (u) => (u.status === "ACTIVE" ? <StatusBadge tone="info">Active</StatusBadge> : <StatusBadge tone="neutral">Cancelled</StatusBadge>) },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (u) =>
        u.status === "ACTIVE" ? (
          <Button variant="ghost" size="sm" onClick={() => setCancelling(u)} aria-label={`Cancel unavailability for ${nameOf(u)} on ${formatDate(u.date)}, ${periodText(u)}`}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <PageBody>
      <PageHeader
        title="Unavailability"
        description="Periods when a teacher can’t be chosen as a substitute, for example during a meeting. Their own lessons are not affected."
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={!teachers.data}>
            <Plus aria-hidden /> Add unavailability
          </Button>
        }
      />
      <Toolbar>
        <div className="space-y-1">
          <Label htmlFor="unavail-status" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "CANCELLED")}>
            <SelectTrigger id="unavail-status" className="w-full sm:w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="unavail-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input id="unavail-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-full sm:w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="unavail-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input id="unavail-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-full sm:w-40" />
        </div>
      </Toolbar>

      {list.isPending ? (
        <TableSkeleton rows={6} columns={5} />
      ) : list.isError && !list.data ? (
        <ErrorState error={list.error} title="Couldn’t load unavailability" onRetry={() => void list.refetch()} />
      ) : (
        <>
          {list.isRefetchError ? <StaleDataNotice onRetry={() => void list.refetch()} /> : null}
          {rows.length === 0 ? (
            <EmptyState
              icon={<CalendarOff className="size-5" />}
              title={status === "ACTIVE" ? "No unavailability recorded for these dates" : "No cancelled unavailability for these dates"}
              description={status === "ACTIVE" ? "Mark a teacher unavailable so they aren’t picked as a substitute." : undefined}
              action={status === "ACTIVE" ? <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!teachers.data}>Add unavailability</Button> : null}
            />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable data={rows} columns={columns} getRowId={(u) => u.id} caption="Teacher unavailability" dense pageSize={50} />
              </div>
              <ul className="space-y-2 md:hidden" aria-label="Teacher unavailability">
                {rows.map((u) => (
                  <li key={u.id} className="flex items-start justify-between gap-2 rounded-xl border bg-surface shadow-card p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{nameOf(u)}</p>
                      <p className="text-muted-foreground">
                        {formatDate(u.date)} · {periodText(u)}
                      </p>
                      {u.reason ? <p className="text-muted-foreground">{u.reason}</p> : null}
                    </div>
                    {u.status === "ACTIVE" ? (
                      <Button variant="outline" size="sm" onClick={() => setCancelling(u)} aria-label={`Cancel unavailability for ${nameOf(u)} on ${formatDate(u.date)}, ${periodText(u)}`}>
                        Cancel
                      </Button>
                    ) : (
                      <StatusBadge tone="neutral">Cancelled</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <CreateUnavailabilityDialog open={createOpen} onOpenChange={setCreateOpen} teachers={teacherList} />
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => (!open ? setCancelling(null) : undefined)}
        title="Cancel this unavailability?"
        description={cancelling ? `${nameOf(cancelling)} can be chosen as a substitute again on ${formatDate(cancelling.date)} (${periodText(cancelling).toLowerCase()}).` : null}
        confirmLabel="Cancel unavailability"
        cancelLabel="Keep"
        destructive
        onConfirm={async () => {
          if (!cancelling) return;
          try {
            await cancel.mutateAsync(cancelling.id);
            notifySuccess("Unavailability cancelled");
          } catch (error) {
            if (isApiError(error) && error.uncertain) notifyError(error, "Couldn’t confirm the cancellation");
            throw error;
          }
        }}
      />
    </PageBody>
  );
}

function CreateUnavailabilityDialog({ open, onOpenChange, teachers }: { open: boolean; onOpenChange: (open: boolean) => void; teachers: TeacherListItem[] }) {
  const [result, setResult] = useState<Unavailability | null>(null);
  const [key, setKey] = useState(0);
  function change(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setResult(null);
      setKey((k) => k + 1);
    }
  }
  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Unavailability added" : "Add unavailability"}</DialogTitle>
          <DialogDescription>
            {result ? "The teacher won’t be chosen as a substitute for this time." : "The teacher won’t be offered as a substitute for this date or period."}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            {result.automaticReallocation ? (
              <AllocationNotice automaticAllocation={result.automaticReallocation} />
            ) : (
              <p className="text-sm text-muted-foreground">No cover had to change.</p>
            )}
            <DialogFooter>
              <Button onClick={() => change(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : open ? (
          <UnavailabilityForm key={key} teachers={teachers} onDone={setResult} onCancel={() => change(false)} onUncertain={() => change(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UnavailabilityForm({ teachers, onDone, onCancel, onUncertain }: { teachers: TeacherListItem[]; onDone: (u: Unavailability) => void; onCancel: () => void; onUncertain: () => void }) {
  const form = useForm<UnavailabilityFormValues>({
    resolver: zodResolver(unavailabilityFormSchema),
    defaultValues: { teacherId: "", date: todayUtc(), wholeDay: true, periodNumber: undefined, reason: "" },
  });
  const wholeDay = useWatch({ control: form.control, name: "wholeDay" });
  const create = useCreateUnavailability();
  const inFlight = useRef(false);
  const [alert, setAlert] = useState<ReactNode>(null);
  const options = teachers
    .filter((t) => t.isActive)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.employeeCode ? `${t.name} (${t.employeeCode})` : t.name }));

  async function submit(values: UnavailabilityFormValues) {
    if (inFlight.current) return;
    inFlight.current = true;
    setAlert(null);
    try {
      const created = await create.mutateAsync(toCreateUnavailabilityBody(values));
      notifySuccess("Unavailability added");
      onDone(created);
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, "Couldn’t confirm the unavailability was added");
        onUncertain();
        return;
      }
      if (isApiError(error) && error.code === "TEACHER_IS_COVERING") {
        setAlert(<RefusalWithLessons message={error.message} lessons={lessonsFromDetails(error.details)} />);
      } else if (isApiError(error) && Object.keys(error.fieldErrors).length > 0) {
        const leftovers = applyServerErrors(error, form.setError, UNAVAILABILITY_FORM_FIELDS);
        setAlert(leftovers.length > 0 ? leftovers.join(" ") : null);
      } else {
        setAlert(isApiError(error) ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate className="space-y-4">
      {alert ? <FormAlert>{alert}</FormAlert> : null}
      <SelectField control={form.control} name="teacherId" label="Teacher" options={options} placeholder="Choose a teacher" disabled={create.isPending} />
      <TextField control={form.control} name="date" label="Date" type="date" disabled={create.isPending} />
      <CheckboxField control={form.control} name="wholeDay" label="Whole day" disabled={create.isPending} />
      {!wholeDay ? <NumberField control={form.control} name="periodNumber" label="Period" min={1} max={12} disabled={create.isPending} /> : null}
      <TextAreaField control={form.control} name="reason" label="Reason (optional)" rows={2} disabled={create.isPending} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={create.isPending}>
          Close
        </Button>
        <PendingButton type="submit" pending={create.isPending}>
          Add unavailability
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
