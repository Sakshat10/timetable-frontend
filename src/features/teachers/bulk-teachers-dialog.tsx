"use client";

import { useId, useState, type ClipboardEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormAlert } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { isApiError } from "@/lib/api/errors";
import { notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { useCreateTeachers } from "./hooks";
import { bulkPayload, bulkServerErrors, filledRows, MAX_BULK_TEACHERS, validateBulkRows, type BulkRow } from "./rules";

const emptyRows = (count: number): BulkRow[] => Array.from({ length: count }, () => ({ name: "", employeeCode: "" }));

export function BulkTeachersDialog({ open, onOpenChange, yearId }: { open: boolean; onOpenChange: (open: boolean) => void; yearId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? <BulkForm yearId={yearId} onDone={() => onOpenChange(false)} onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type RowErrors = Record<number, { name?: string; employeeCode?: string }>;

function BulkForm({ yearId, onDone, onBusyChange }: { yearId: string; onDone: () => void; onBusyChange: (busy: boolean) => void }) {
  const create = useCreateTeachers(yearId);
  const idBase = useId();
  const [rows, setRows] = useState<BulkRow[]>(() => emptyRows(3));
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Set after an uncertain outcome: the rows are frozen and a retry re-sends the SAME key and body. */
  const [uncertainKey, setUncertainKey] = useState<string | null>(null);
  const pending = create.isPending;
  const filled = filledRows(rows);

  // Errors are keyed by the index among the filled rows (what was sent); map back to visible rows.
  const filledIndexOf = (visibleIndex: number) => {
    let count = -1;
    for (let i = 0; i <= visibleIndex; i++) if (rows[i] && (rows[i].name.trim() !== "" || rows[i].employeeCode.trim() !== "")) count++;
    const row = rows[visibleIndex];
    return row && (row.name.trim() !== "" || row.employeeCode.trim() !== "") ? count : -1;
  };

  function setRow(index: number, patch: Partial<BulkRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setRowErrors({});
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    event.preventDefault();
    const pasted = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = "", code = ""] = line.split(/\t|,/);
        return { name: name.trim(), employeeCode: code.trim() };
      });
    setRows((current) => {
      const next = [...current.slice(0, index), ...pasted, ...current.slice(index + 1)];
      return next.slice(0, MAX_BULK_TEACHERS);
    });
    setRowErrors({});
  }

  async function submit() {
    if (pending) return;
    setFormError(null);
    if (filled.length === 0) {
      setFormError("Enter at least one teacher.");
      return;
    }
    if (filled.length > MAX_BULK_TEACHERS) {
      setFormError(`At most ${MAX_BULK_TEACHERS} teachers can be added at once.`);
      return;
    }
    const local = validateBulkRows(rows);
    if (Object.keys(local).length > 0) {
      setRowErrors(local);
      return;
    }
    // One key per submission; reused only when retrying an uncertain attempt with identical rows.
    const key = uncertainKey ?? crypto.randomUUID();
    onBusyChange(true);
    try {
      const result = await create.mutateAsync({ rows: bulkPayload(rows), key });
      notifySuccess(
        result.replayed ? "Teachers were already added" : `${plural(result.teachers.length, "teacher")} added`,
        result.replayed ? "The earlier attempt had succeeded; nothing was added twice." : undefined,
      );
      onBusyChange(false);
      onDone();
    } catch (error) {
      onBusyChange(false);
      if (isApiError(error) && error.uncertain) {
        setUncertainKey(key);
        setFormError(
          "We couldn’t confirm whether these teachers were added. Use “Try again”: the same request is re-sent safely and nothing is added twice.",
        );
        return;
      }
      setUncertainKey(null);
      const mapped = bulkServerErrors(error);
      setRowErrors(mapped.rows);
      const rowCount = Object.keys(mapped.rows).length;
      setFormError(
        rowCount > 0
          ? `Nothing was added. Fix the ${rowCount === 1 ? "highlighted row" : "highlighted rows"} and submit again.`
          : (mapped.general[0] ?? "Nothing was added. Please try again."),
      );
    }
  }

  const frozen = uncertainKey !== null || pending;

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>Add several teachers</DialogTitle>
        <DialogDescription>
          All rows are added together, or none are. Leave a code empty if the teacher has none. You can paste lines of “Name, Code” into a name field.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <div className="hidden grid-cols-[2rem_minmax(0,1fr)_minmax(0,12rem)_2rem] gap-2 px-0.5 text-xs font-medium text-muted-foreground sm:grid">
          <span aria-hidden>#</span>
          <span>Name</span>
          <span>Employee code</span>
          <span className="sr-only">Remove</span>
        </div>
        <ol className="space-y-2">
          {rows.map((row, index) => {
            const errors = rowErrors[filledIndexOf(index)];
            const nameId = `${idBase}-name-${index}`;
            const codeId = `${idBase}-code-${index}`;
            return (
              <li key={index} className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-start gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,12rem)_2rem]">
                <span className="tabular pt-2 text-xs text-muted-foreground">{index + 1}</span>
                <div className="space-y-1">
                  <label htmlFor={nameId} className="sr-only">
                    Row {index + 1} name
                  </label>
                  <Input
                    id={nameId}
                    value={row.name}
                    placeholder="Name"
                    autoComplete="off"
                    maxLength={200}
                    disabled={frozen}
                    aria-invalid={Boolean(errors?.name) || undefined}
                    aria-describedby={errors?.name ? `${nameId}-error` : undefined}
                    onChange={(e) => setRow(index, { name: e.target.value })}
                    onPaste={(e) => onPaste(index, e)}
                  />
                  {errors?.name ? (
                    <p id={`${nameId}-error`} className="text-xs text-destructive">
                      {errors.name}
                    </p>
                  ) : null}
                </div>
                <div className="col-start-2 space-y-1 sm:col-start-auto">
                  <label htmlFor={codeId} className="sr-only">
                    Row {index + 1} employee code
                  </label>
                  <Input
                    id={codeId}
                    value={row.employeeCode}
                    placeholder="Code (optional)"
                    autoComplete="off"
                    maxLength={50}
                    disabled={frozen}
                    aria-invalid={Boolean(errors?.employeeCode) || undefined}
                    aria-describedby={errors?.employeeCode ? `${codeId}-error` : undefined}
                    onChange={(e) => setRow(index, { employeeCode: e.target.value })}
                  />
                  {errors?.employeeCode ? (
                    <p id={`${codeId}-error`} className="text-xs text-destructive">
                      {errors.employeeCode}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto"
                  aria-label={`Remove row ${index + 1}`}
                  disabled={frozen || rows.length === 1}
                  onClick={() => {
                    setRows((current) => current.filter((_, i) => i !== index));
                    setRowErrors({});
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ol>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={frozen || rows.length >= MAX_BULK_TEACHERS}
          onClick={() => setRows((current) => [...current, ...emptyRows(1)])}
        >
          <Plus /> Add row
        </Button>
      </div>

      <FormAlert>{formError}</FormAlert>

      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground tabular">{plural(filled.length, "teacher")} to add</span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            {uncertainKey ? "Close" : "Cancel"}
          </Button>
          <PendingButton type="submit" pending={pending}>
            {uncertainKey ? "Try again" : `Add ${plural(filled.length, "teacher")}`}
          </PendingButton>
        </div>
      </DialogFooter>
    </form>
  );
}
