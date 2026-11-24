"use client";

import { useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { AlertTriangle, CalendarClock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog, BlockedByList, PendingButton } from "@/components/shared/confirm-dialog";
import { applyServerErrors, FormAlert } from "@/components/shared/form-fields";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { DetailList, Panel, StatCard } from "@/components/shared/stat-card";
import { EmptyState, ErrorState, ReadOnlyNotice, StaleDataNotice, TableSkeleton } from "@/components/shared/states";
import { useYear } from "@/features/academic-years/year-context";
import { isApiError } from "@/lib/api/errors";
import { DAY_LABEL, DAY_SHORT, periodLabel, plural } from "@/lib/format";
import { notifyError, notifyInfo, notifySuccess } from "@/lib/notify";
import { DAYS_OF_WEEK, type DayOfWeek, type ScheduleConfig } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useCreateSchedule, useResetSchedule, useSchedule, useUpdateSchedule } from "./hooks";
import {
  clampBreak,
  DEFAULT_SCHEDULE,
  dayPreview,
  MAX_PERIODS,
  MIN_PERIODS,
  orderDays,
  schedulePatch,
  validateSchedule,
  valuesFromConfig,
  weeklyCapacity,
  type ScheduleValues,
} from "./rules";

const FIELDS = ["workingDays", "periodsPerDay", "breakAfterPeriod"] as const;

interface FormValues {
  workingDays: DayOfWeek[];
  periodsPerDay: number | undefined;
  breakAfterPeriod: number | undefined;
}

export function SchedulePage() {
  const { year, capabilities } = useYear();
  const schedule = useSchedule(year.id);
  const config = schedule.data;

  return (
    <PageBody>
      <PageHeader
        eyebrow={year.name}
        title="Schedule"
        description="The school week: which days are taught, how many periods each day has, and where the single break falls. Every working day has the same periods."
      />
      {!capabilities.canEditSetup && capabilities.setupLockedReason ? <ReadOnlyNotice>{capabilities.setupLockedReason}</ReadOnlyNotice> : null}

      {schedule.isPending ? (
        <TableSkeleton rows={4} columns={2} />
      ) : schedule.isError && schedule.data === undefined ? (
        <ErrorState error={schedule.error} title="Couldn’t load the schedule" onRetry={() => void schedule.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {schedule.isError ? <StaleDataNotice onRetry={() => void schedule.refetch()} /> : null}
          {config === null && !capabilities.canEditSetup ? (
            <EmptyState icon={<CalendarClock className="size-5" />} title="No schedule was set" description={`${year.name} has no schedule configuration.`} />
          ) : config?.legacy ? (
            <LegacySchedule key={config.updatedAt} config={config} />
          ) : (
            <ScheduleEditor key={config?.updatedAt ?? "new"} config={config ?? null} />
          )}
        </div>
      )}
    </PageBody>
  );
}

function ScheduleEditor({ config }: { config: ScheduleConfig | null }) {
  const { year, capabilities } = useYear();
  const create = useCreateSchedule(year.id);
  const update = useUpdateSchedule(year.id);
  const reset = useResetSchedule(year.id);
  const schedule = useSchedule(year.id);
  const [formError, setFormError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const initial: ScheduleValues = config ? valuesFromConfig(config) : DEFAULT_SCHEDULE;
  const form = useForm<FormValues>({
    defaultValues: initial,
    resolver: (values) => {
      const errors = validateSchedule(values);
      const entries = Object.entries(errors);
      return entries.length === 0
        ? { values, errors: {} }
        : { values: {}, errors: Object.fromEntries(entries.map(([k, message]) => [k, { type: "validate", message }])) };
    },
  });
  const disabled = !capabilities.canEditSetup;
  const pending = form.formState.isSubmitting;
  const watched = useWatch({ control: form.control });
  const days = orderDays(watched.workingDays ?? []);
  const periods = watched.periodsPerDay;
  const periodsValid = periods !== undefined && Number.isInteger(periods) && periods >= MIN_PERIODS && periods <= MAX_PERIODS;
  const breakAfter = watched.breakAfterPeriod ?? null;
  const dirty = config
    ? periodsValid && breakAfter !== null && Object.keys(schedulePatch(config, { workingDays: days, periodsPerDay: periods, breakAfterPeriod: breakAfter })).length > 0
    : true;

  async function onSubmit(raw: FormValues) {
    setFormError(null);
    const values: ScheduleValues = { workingDays: orderDays(raw.workingDays), periodsPerDay: raw.periodsPerDay ?? 0, breakAfterPeriod: raw.breakAfterPeriod ?? 0 };
    try {
      if (config) {
        const body = schedulePatch(config, values);
        if (Object.keys(body).length === 0) return;
        await update.mutateAsync({ id: config.id, body });
        notifySuccess("Schedule saved", "Existing timetable drafts are now out of date. Generate again to use the new schedule.");
      } else {
        await create.mutateAsync({ academicYearId: year.id, ...values });
        notifySuccess("Schedule saved");
      }
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        notifyError(error, "Couldn’t confirm the schedule was saved");
        return;
      }
      if (!config && isApiError(error) && error.isConflict) {
        notifyInfo("A schedule already exists for this year", "It has been loaded. Review it and save your changes again.");
        void schedule.refetch();
        return;
      }
      const leftovers = applyServerErrors(error, form.setError, FIELDS);
      const matched = isApiError(error) && Object.keys(error.fieldErrors).some((k) => (FIELDS as readonly string[]).includes(k));
      if (leftovers.length > 0 || !matched) setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t save the schedule."));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Panel className="space-y-6">
        {config === null ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{year.name} has no schedule yet. Adjust the suggestion below and save it.</p>
          </div>
        ) : null}
        <WorkingDaysField control={form.control} disabled={disabled} />
        <div className="grid gap-6 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="periodsPerDay"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="periodsPerDay">Periods per day</FieldLabel>
                <Input
                  id="periodsPerDay"
                  ref={field.ref}
                  name={field.name}
                  onBlur={field.onBlur}
                  type="number"
                  inputMode="numeric"
                  min={MIN_PERIODS}
                  max={MAX_PERIODS}
                  step={1}
                  className="tabular sm:w-32"
                  disabled={disabled}
                  aria-invalid={fieldState.invalid || undefined}
                  value={field.value === undefined || Number.isNaN(field.value) ? "" : String(field.value)}
                  onChange={(e) => {
                    const next = e.target.value === "" ? undefined : Number(e.target.value);
                    field.onChange(next);
                    const currentBreak = form.getValues("breakAfterPeriod");
                    if (next !== undefined && Number.isInteger(next) && next >= MIN_PERIODS && next <= MAX_PERIODS && currentBreak !== undefined) {
                      const clamped = clampBreak(currentBreak, next);
                      if (clamped !== currentBreak) form.setValue("breakAfterPeriod", clamped);
                    }
                  }}
                />
                <FieldDescription>
                  From {MIN_PERIODS} to {MAX_PERIODS} teaching periods.
                </FieldDescription>
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="breakAfterPeriod"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="breakAfterPeriod">Break after</FieldLabel>
                <Select
                  value={field.value === undefined ? "" : String(field.value)}
                  onValueChange={(v) => field.onChange(Number(v))}
                  disabled={disabled || !periodsValid}
                >
                  <SelectTrigger id="breakAfterPeriod" className="w-full sm:w-40" aria-invalid={fieldState.invalid || undefined}>
                    <SelectValue placeholder="Choose a period" />
                  </SelectTrigger>
                  <SelectContent>
                    {periodsValid
                      ? Array.from({ length: periods - 1 }, (_, i) => i + 1).map((p) => (
                          <SelectItem key={p} value={String(p)}>
                            {periodLabel(p)}
                          </SelectItem>
                        ))
                      : null}
                  </SelectContent>
                </Select>
                <FieldDescription>One break per day, between two teaching periods.</FieldDescription>
                {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
              </Field>
            )}
          />
        </div>

        {config && capabilities.canEditSetup ? (
          <div role="note" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-2 text-sm text-warning-foreground dark:text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            Changing the schedule makes existing timetable drafts for {year.name} out of date. Generate again afterwards.
          </div>
        ) : null}

        <FormAlert>{formError}</FormAlert>

        {capabilities.canEditSetup ? (
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            {config ? (
              <Button type="button" variant="destructive" onClick={() => setResetOpen(true)} disabled={pending}>
                Reset schedule
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {config ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || !dirty}
                  onClick={() => {
                    form.reset(initial);
                    setFormError(null);
                  }}
                >
                  Discard changes
                </Button>
              ) : null}
              <PendingButton type="submit" pending={pending} disabled={config !== null && !dirty}>
                {config ? "Save changes" : "Save schedule"}
              </PendingButton>
            </div>
          </div>
        ) : null}
      </Panel>

      <SchedulePreview days={days} periods={periodsValid ? periods : null} breakAfter={breakAfter} />

      {config ? (
        <ConfirmDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title="Reset the schedule?"
          description={`The schedule for ${year.name} is deleted. A new one must be saved before timetables can be generated.`}
          confirmLabel="Reset schedule"
          destructive
          errorRender={(error) => <BlockedByList error={error} />}
          onConfirm={async () => {
            try {
              await reset.mutateAsync(config.id);
              notifySuccess("Schedule reset");
            } catch (error) {
              if (isApiError(error) && error.uncertain) {
                notifyError(error, "Couldn’t confirm the reset");
                return;
              }
              throw error;
            }
          }}
        >
          <p className="text-muted-foreground">The server refuses while the year has timetable versions or a generation in progress.</p>
        </ConfirmDialog>
      ) : null}
    </form>
  );
}

function WorkingDaysField({ control, disabled }: { control: Control<FormValues>; disabled: boolean }) {
  return (
    <Controller
      control={control}
      name="workingDays"
      render={({ field, fieldState }) => {
        const selected = new Set(field.value);
        return (
          <FieldSet data-invalid={fieldState.invalid || undefined}>
            <FieldLegend variant="label">Working days</FieldLegend>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const on = selected.has(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_LABEL[day]}
                    disabled={disabled}
                    onClick={() => field.onChange(orderDays(on ? field.value.filter((d) => d !== day) : [...field.value, day]))}
                    className={cn(
                      "h-9 min-w-14 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {DAY_SHORT[day]}
                  </button>
                );
              })}
            </div>
            <FieldDescription>{plural(field.value.length, "working day")} selected.</FieldDescription>
            {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
          </FieldSet>
        );
      }}
    />
  );
}

function SchedulePreview({ days, periods, breakAfter }: { days: DayOfWeek[]; periods: number | null; breakAfter: number | null }) {
  const items = periods ? dayPreview(periods, breakAfter !== null && breakAfter < periods ? breakAfter : null) : [];
  return (
    <div className="flex flex-col gap-4">
      <StatCard
        label="Weekly teaching capacity"
        value={periods && days.length > 0 ? weeklyCapacity({ workingDays: days, periodsPerDay: periods }) : "—"}
        hint={periods && days.length > 0 ? `${plural(days.length, "day")} × ${plural(periods, "period")}. The break adds none.` : "Choose days and periods."}
      />
      <Panel>
        <h2 className="text-sm font-semibold text-foreground">A school day</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Same on every working day.</p>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Enter a valid number of periods to see the day.</p>
        ) : (
          <ol className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Day preview">
            {items.map((item) =>
              item.kind === "PERIOD" ? (
                <li key={`p${item.periodNumber}`} className="tabular flex h-8 min-w-10 items-center justify-center rounded-md border bg-muted/40 px-2 text-xs font-medium">
                  {periodLabel(item.periodNumber)}
                </li>
              ) : (
                <li key="break" className="flex h-8 items-center rounded-md border border-dashed border-primary/40 px-2 text-xs font-medium text-primary">
                  Break
                </li>
              ),
            )}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function LegacySchedule({ config }: { config: ScheduleConfig }) {
  const { year, capabilities } = useYear();
  const update = useUpdateSchedule(year.id);
  const [breakAfter, setBreakAfter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const days = orderDays(config.workingDays);

  async function save() {
    if (!breakAfter) {
      setError("Choose where the break falls.");
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ id: config.id, body: { breakAfterPeriod: Number(breakAfter) } });
      notifySuccess("Break position saved", "The schedule now uses the simplified model.");
    } catch (e) {
      if (isApiError(e) && e.uncertain) {
        notifyError(e, "Couldn’t confirm the change");
        return;
      }
      setError(isApiError(e) ? (e.fieldError("breakAfterPeriod") ?? e.message) : "Couldn’t save. Please try again.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Panel className="space-y-5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            This schedule was made with an older format and has no single break position. Choose where the break falls to convert it; the working days and number
            of periods stay as they are.
          </p>
        </div>
        <DetailList
          items={[
            { label: "Working days", value: days.map((d) => DAY_LABEL[d]).join(", ") },
            { label: "Periods per day", value: config.periodsPerDay },
          ]}
        />
        {capabilities.canEditSetup ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field className="sm:w-48">
              <FieldLabel htmlFor="legacy-break">Break after</FieldLabel>
              <Select value={breakAfter} onValueChange={setBreakAfter}>
                <SelectTrigger id="legacy-break" className="w-full">
                  <SelectValue placeholder="Choose a period" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: config.periodsPerDay - 1 }, (_, i) => i + 1).map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {periodLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <PendingButton type="button" pending={update.isPending} onClick={() => void save()}>
              Set break position
            </PendingButton>
          </div>
        ) : null}
        <FormAlert>{error}</FormAlert>
      </Panel>
      <SchedulePreview days={days} periods={config.periodsPerDay} breakAfter={breakAfter ? Number(breakAfter) : null} />
    </div>
  );
}
