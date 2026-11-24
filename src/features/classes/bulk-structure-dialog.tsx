"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormAlert } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { gradesApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { notifyError, notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { splitServerErrors, type PathErrors } from "@/features/curriculum/form-errors";
import { FieldMessage, RowField } from "@/features/curriculum/shared-ui";
import {
  buildStructurePayload,
  emptyGradeRow,
  rowKey,
  STRUCTURE_LIMITS,
  structurePaths,
  validateStructure,
  type StructureGradeRow,
} from "./rules";

export function BulkStructureDialog({
  open,
  onOpenChange,
  yearId,
  existing,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  existing: ReadonlyArray<{ name: string; displayOrder: number }>;
  invalidate: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        {open ? <BulkForm yearId={yearId} existing={existing} invalidate={invalidate} close={() => onOpenChange(false)} pending={pending} setPending={setPending} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({
  yearId,
  existing,
  invalidate,
  close,
  pending,
  setPending,
}: {
  yearId: string;
  existing: ReadonlyArray<{ name: string; displayOrder: number }>;
  invalidate: () => Promise<void>;
  close: () => void;
  pending: boolean;
  setPending: (pending: boolean) => void;
}) {
  const firstOrder = existing.reduce((m, g) => Math.max(m, g.displayOrder), 0) + 1;
  const [rows, setRows] = useState<StructureGradeRow[]>(() => [emptyGradeRow(firstOrder)]);
  const [errors, setErrors] = useState<PathErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const update = (index: number, change: (row: StructureGradeRow) => StructureGradeRow, clearPath?: string) => {
    setRows((current) => current.map((row, i) => (i === index ? change(row) : row)));
    if (clearPath)
      setErrors((current) => {
        const next = { ...current };
        delete next[clearPath];
        return next;
      });
  };
  // Row positions change when a row is removed, so stale path-keyed errors are cleared.
  const removeAt = <T,>(list: T[], at: number) => list.filter((_, i) => i !== at);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormErrors([]);
    const body = buildStructurePayload(yearId, rows);
    const local = validateStructure(body, existing);
    if (Object.keys(local).length > 0) {
      setErrors(local);
      setFormErrors(local.grades ? [local.grades] : ["Fix the highlighted fields."]);
      return;
    }
    setPending(true);
    try {
      const result = await gradesApi.createStructure(body);
      await invalidate();
      const created = result.grades?.length ?? rows.length;
      notifySuccess(`${plural(created, "grade")} added`, rows.map((r) => r.name.trim()).join(", "));
      setPending(false);
      close();
    } catch (error) {
      setPending(false);
      if (isApiError(error) && error.uncertain) {
        await invalidate();
        notifyError(error);
        close();
        return;
      }
      const known = structurePaths(rows);
      const { byPath, leftovers } = splitServerErrors(error, (p) => known.has(p));
      setErrors(byPath);
      const rowLevel = Object.entries(byPath)
        .filter(([path]) => /^grades(\.\d+)?(\.(streams|sections))?(\.\d+)?$/.test(path))
        .map(([, m]) => m);
      const messages = [...leftovers, ...rowLevel];
      if (messages.length === 0) messages.push(isApiError(error) && Object.keys(byPath).length > 0 ? `${error.message}. Nothing was created; fix the highlighted fields.` : isApiError(error) ? error.message : "Something went wrong. Please try again.");
      setFormErrors(messages);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add several grades</DialogTitle>
        <DialogDescription>
          Create grades with their streams and sections in one step. Everything is created together, or nothing is. Up to {STRUCTURE_LIMITS.grades} grades and{" "}
          {STRUCTURE_LIMITS.totalSections} sections at once.
        </DialogDescription>
      </DialogHeader>

      <ol className="grid gap-4">
        {rows.map((row, gi) => {
          const base = `grades.${gi}`;
          const label = row.name.trim() || `Grade ${gi + 1}`;
          return (
            <li key={row.key} className="rounded-lg border bg-surface p-3 sm:p-4" aria-label={`Grade row ${gi + 1}`}>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-start">
                <RowField
                  label="Grade name"
                  accessibleName={`Grade ${gi + 1} name`}
                  value={row.name}
                  maxLength={100}
                  placeholder="e.g. Grade 6"
                  onChange={(v) => update(gi, (r) => ({ ...r, name: v }), `${base}.name`)}
                  error={errors[`${base}.name`]}
                />
                <RowField
                  label="Display order"
                  accessibleName={`Grade ${gi + 1} display order`}
                  value={row.displayOrder}
                  inputMode="numeric"
                  onChange={(v) => update(gi, (r) => ({ ...r, displayOrder: v }), `${base}.displayOrder`)}
                  error={errors[`${base}.displayOrder`]}
                />
                <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:pt-5">
                  <div className="flex items-center gap-2">
                    <Switch
                      id={`${row.key}-streams`}
                      checked={row.useStreams}
                      onCheckedChange={(checked) =>
                        update(gi, (r) => ({ ...r, useStreams: checked, streams: checked && r.streams.length === 0 ? [{ key: rowKey("s"), name: "", code: "" }] : r.streams }))
                      }
                    />
                    <Label htmlFor={`${row.key}-streams`} className="text-sm font-normal">
                      Uses streams
                    </Label>
                  </div>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${label}`}
                      onClick={() => {
                        setRows((c) => removeAt(c, gi));
                        setErrors({});
                      }}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </div>

              {row.useStreams ? (
                <fieldset className="mt-3 grid gap-2 border-t pt-3">
                  <legend className="sr-only">Streams of {label}</legend>
                  <p className="text-xs font-medium text-foreground">Streams</p>
                  {row.streams.map((stream, si) => (
                    <div key={stream.key} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2">
                      <RowField
                        label="Stream name"
                        accessibleName={`Grade ${gi + 1} stream ${si + 1} name`}
                        value={stream.name}
                        maxLength={100}
                        placeholder="e.g. Science"
                        onChange={(v) => update(gi, (r) => ({ ...r, streams: r.streams.map((s, i) => (i === si ? { ...s, name: v } : s)) }), `${base}.streams.${si}.name`)}
                        error={errors[`${base}.streams.${si}.name`]}
                      />
                      <RowField
                        label="Code"
                        accessibleName={`Grade ${gi + 1} stream ${si + 1} code`}
                        value={stream.code}
                        maxLength={20}
                        placeholder="SCI"
                        onChange={(v) => update(gi, (r) => ({ ...r, streams: r.streams.map((s, i) => (i === si ? { ...s, code: v } : s)) }), `${base}.streams.${si}.code`)}
                        error={errors[`${base}.streams.${si}.code`]}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mt-6"
                        aria-label={`Remove stream ${si + 1} of ${label}`}
                        onClick={() => {
                          update(gi, (r) => ({ ...r, streams: removeAt(r.streams, si) }));
                          setErrors({});
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  {errors[`${base}.streams`] ? <FieldMessage>{errors[`${base}.streams`]}</FieldMessage> : null}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={row.streams.length >= STRUCTURE_LIMITS.streamsPerGrade}
                      onClick={() => update(gi, (r) => ({ ...r, streams: [...r.streams, { key: rowKey("s"), name: "", code: "" }] }))}
                    >
                      <Plus /> Add stream
                    </Button>
                  </div>
                </fieldset>
              ) : null}

              <fieldset className="mt-3 grid gap-2 border-t pt-3">
                <legend className="sr-only">Sections of {label}</legend>
                <p className="text-xs font-medium text-foreground">Sections</p>
                {row.sections.length === 0 ? <p className="text-xs text-muted-foreground">No sections yet. You can also add them later.</p> : null}
                {row.sections.map((section, si) => (
                  <div key={section.key} className={row.useStreams ? "grid grid-cols-2 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_10rem_auto]" : "grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2"}>
                    <RowField
                      label="Section name"
                      accessibleName={`Grade ${gi + 1} section ${si + 1} name`}
                      value={section.name}
                      maxLength={100}
                      placeholder="e.g. Section A"
                      onChange={(v) => update(gi, (r) => ({ ...r, sections: r.sections.map((s, i) => (i === si ? { ...s, name: v } : s)) }), `${base}.sections.${si}.name`)}
                      error={errors[`${base}.sections.${si}.name`]}
                    />
                    <RowField
                      label="Code"
                      accessibleName={`Grade ${gi + 1} section ${si + 1} code`}
                      value={section.code}
                      maxLength={20}
                      placeholder="A"
                      onChange={(v) => update(gi, (r) => ({ ...r, sections: r.sections.map((s, i) => (i === si ? { ...s, code: v } : s)) }), `${base}.sections.${si}.code`)}
                      error={errors[`${base}.sections.${si}.code`]}
                    />
                    {row.useStreams ? (
                      <div className="min-w-0 space-y-1">
                        <span className="text-xs font-medium text-muted-foreground" aria-hidden>
                          Stream
                        </span>
                        <Select
                          value={section.streamCode}
                          onValueChange={(v) => update(gi, (r) => ({ ...r, sections: r.sections.map((s, i) => (i === si ? { ...s, streamCode: v } : s)) }), `${base}.sections.${si}.streamCode`)}
                        >
                          <SelectTrigger className="w-full" aria-label={`Grade ${gi + 1} section ${si + 1} stream`} aria-invalid={errors[`${base}.sections.${si}.streamCode`] ? true : undefined}>
                            <SelectValue placeholder="Choose" />
                          </SelectTrigger>
                          <SelectContent>
                            {row.streams
                              .filter((s) => s.code.trim())
                              .map((s) => (
                                <SelectItem key={s.key} value={s.code.trim()}>
                                  {s.name.trim() || s.code.trim()} ({s.code.trim()})
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {errors[`${base}.sections.${si}.streamCode`] ? <FieldMessage>{errors[`${base}.sections.${si}.streamCode`]}</FieldMessage> : null}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="mt-6"
                      aria-label={`Remove section ${si + 1} of ${label}`}
                      onClick={() => {
                        update(gi, (r) => ({ ...r, sections: removeAt(r.sections, si) }));
                        setErrors({});
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                {errors[`${base}.sections`] ? <FieldMessage>{errors[`${base}.sections`]}</FieldMessage> : null}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={row.sections.length >= STRUCTURE_LIMITS.sectionsPerGrade}
                    onClick={() =>
                      update(gi, (r) => {
                        const letter = String.fromCharCode(65 + (r.sections.length % 26));
                        return { ...r, sections: [...r.sections, { key: rowKey("sec"), name: `Section ${letter}`, code: letter, streamCode: r.useStreams && r.streams.length === 1 ? r.streams[0].code.trim() : "" }] };
                      })
                    }
                  >
                    <Plus /> Add section
                  </Button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>

      <div>
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= STRUCTURE_LIMITS.grades}
          onClick={() => {
            const orders = rows.map((r) => Number(r.displayOrder)).filter(Number.isFinite);
            setRows((c) => [...c, emptyGradeRow(Math.max(firstOrder - 1, ...orders) + 1)]);
          }}
        >
          <Plus /> Add another grade
        </Button>
      </div>

      <FormAlert>
        {formErrors.length > 0 ? (
          <>
            {formErrors.map((m) => (
              <p key={m}>{m}</p>
            ))}
          </>
        ) : null}
      </FormAlert>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={pending}>
          Create {plural(rows.length, "grade")}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
