"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { FormAlert, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { subjectsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { Subject } from "@/lib/api/types";
import { notifyError, notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { formErrorMessage, splitServerErrors } from "@/features/curriculum/form-errors";
import { RowField } from "@/features/curriculum/shared-ui";
import {
  buildSubjectsPayload,
  CODE_HINT,
  MAX_BULK_SUBJECTS,
  normaliseSubjectCode,
  rowErrorsFromPaths,
  subjectFormSchema,
  suggestSubjectCode,
  validateSubjectsPayload,
  type SubjectFormInput,
  type SubjectFormValues,
  type SubjectRow,
} from "./rules";

type Invalidate = () => Promise<void>;

export function SubjectDialog({
  open,
  onOpenChange,
  subject,
  invalidate,
  existingCodes = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: Subject;
  invalidate: Invalidate;
  /** Codes of the school's subjects, so a suggested code never clashes with them. */
  existingCodes?: readonly string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <SubjectForm subject={subject} invalidate={invalidate} close={() => onOpenChange(false)} existingCodes={existingCodes} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SubjectForm({
  subject,
  invalidate,
  close,
  existingCodes,
}: {
  subject?: Subject;
  invalidate: Invalidate;
  close: () => void;
  existingCodes: readonly string[];
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<SubjectFormInput, unknown, SubjectFormValues>({
    resolver: zodResolver(subjectFormSchema),
    defaultValues: { name: subject?.name ?? "", code: subject?.code ?? "" },
  });
  const codePreview = normaliseSubjectCode(useWatch({ control: form.control, name: "code" }) ?? "");

  // New subjects: the code follows the name until the administrator types a code of their own (editing never
  // changes an existing code by itself).
  const name = useWatch({ control: form.control, name: "name" });
  const lastAutoCode = useRef("");
  const takenKey = existingCodes.map(normaliseSubjectCode).join("|"); // stable dependency (arrays change identity)
  useEffect(() => {
    if (subject) return;
    const current = form.getValues("code") ?? "";
    if (current.trim() !== "" && current !== lastAutoCode.current) return;
    const code = suggestSubjectCode(name ?? "", new Set(takenKey ? takenKey.split("|") : []));
    if (code === current) return;
    lastAutoCode.current = code;
    form.setValue("code", code, { shouldValidate: form.formState.isSubmitted, shouldDirty: true });
  }, [name, subject, takenKey, form]);

  async function onSubmit(values: SubjectFormValues) {
    setFormError(null);
    try {
      if (subject) {
        const body: { name?: string; code?: string } = {};
        if (values.name !== subject.name) body.name = values.name;
        if (values.code !== subject.code) body.code = values.code;
        if (Object.keys(body).length > 0) await subjectsApi.update(subject.id, body);
      } else {
        await subjectsApi.create(values);
      }
      await invalidate();
      notifySuccess(subject ? "Subject updated" : "Subject added", `${values.name} (${values.code})`);
      close();
    } catch (error) {
      if (isApiError(error) && error.uncertain) {
        await invalidate();
        notifyError(error);
        close();
        return;
      }
      setFormError(formErrorMessage(error, form.setError, ["name", "code"]));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{subject ? "Edit subject" : "Add subject"}</DialogTitle>
        <DialogDescription>Subjects are shared by every academic year of the school. Codes are unique.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="name" label="Subject name" placeholder="e.g. Mathematics" autoFocus maxLength={100} />
        <TextField
          control={form.control}
          name="code"
          label="Code"
          placeholder="e.g. MATH"
          maxLength={20}
          description={codePreview ? `${CODE_HINT} Will be saved as ${codePreview}.` : CODE_HINT}
        />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={form.formState.isSubmitting}>
          {subject ? "Save subject" : "Add subject"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}

// ------------------------------------------------------------------ add several

let seq = 0;
const newRow = (): SubjectRow => ({ key: `subject-row-${++seq}`, name: "", code: "" });

export function BulkSubjectsDialog({
  open,
  onOpenChange,
  invalidate,
  existingCodes = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidate: Invalidate;
  /** Codes of the school's subjects, so suggested codes never clash with them. */
  existingCodes?: readonly string[];
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open ? <BulkForm invalidate={invalidate} close={() => onOpenChange(false)} pending={pending} setPending={setPending} existingCodes={existingCodes} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({
  invalidate,
  close,
  pending,
  setPending,
  existingCodes,
}: {
  invalidate: Invalidate;
  close: () => void;
  pending: boolean;
  setPending: (p: boolean) => void;
  existingCodes: readonly string[];
}) {
  const [rows, setRows] = useState<SubjectRow[]>(() => [newRow(), newRow(), newRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<"name" | "code", string>>>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const filled = buildSubjectsPayload(rows).subjects.length;

  // The code each row was last given automatically. A row whose code is empty or still equals it follows its name;
  // once the administrator types a different code, that code is kept.
  const [autoCodes, setAutoCodes] = useState<Record<string, string>>({});

  const clearError = (key: string, field: "name" | "code") =>
    setRowErrors((c) => (c[key]?.[field] ? { ...c, [key]: { ...c[key], [field]: undefined } } : c));

  const edit = (key: string, field: "name" | "code", value: string) => {
    const row = rows.find((r) => r.key === key);
    if (field === "name" && row && (row.code.trim() === "" || row.code === autoCodes[key])) {
      const taken = new Set([
        ...existingCodes.map(normaliseSubjectCode),
        ...rows.filter((r) => r.key !== key).map((r) => normaliseSubjectCode(r.code)).filter(Boolean),
      ]);
      const code = suggestSubjectCode(value, taken);
      setRows((c) => c.map((r) => (r.key === key ? { ...r, name: value, code } : r)));
      setAutoCodes((c) => ({ ...c, [key]: code }));
      clearError(key, "code");
    } else {
      setRows((c) => c.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
    }
    clearError(key, field);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFormErrors([]);
    const { subjects, rowKeys } = buildSubjectsPayload(rows);
    const local = validateSubjectsPayload(subjects);
    if (Object.keys(local).length > 0) {
      const mapped = rowErrorsFromPaths(local, rowKeys);
      setRowErrors(mapped.rows);
      setFormErrors(mapped.leftovers.length > 0 ? mapped.leftovers : ["Fix the highlighted fields."]);
      return;
    }
    setPending(true);
    try {
      const created = await subjectsApi.createMany(subjects);
      await invalidate();
      notifySuccess(`${plural(created.length, "subject")} added`, created.map((s) => s.code).join(", "));
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
      const { byPath, leftovers } = splitServerErrors(error, (p) => /^subjects\.\d+\.(name|code)$/.test(p));
      const mapped = rowErrorsFromPaths(byPath, rowKeys);
      setRowErrors(mapped.rows);
      const messages = [...leftovers, ...mapped.leftovers];
      if (Object.keys(mapped.rows).length > 0) messages.unshift("Nothing was added. Fix the highlighted rows and try again.");
      else if (messages.length === 0) messages.push(isApiError(error) ? error.message : "Something went wrong. Please try again.");
      setFormErrors(messages);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Add several subjects</DialogTitle>
        <DialogDescription>
          All rows are added together, or none are. Empty rows are ignored. Up to {MAX_BULK_SUBJECTS} at once. Codes are filled in from the
          names; change any you like. {CODE_HINT}
        </DialogDescription>
      </DialogHeader>
      <ol className="grid gap-3">
        {rows.map((row, i) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_8rem_auto] items-start gap-2">
            <RowField label="Subject name" accessibleName={`Row ${i + 1} subject name`} value={row.name} maxLength={100} onChange={(v) => edit(row.key, "name", v)} error={rowErrors[row.key]?.name} />
            <RowField label="Code" accessibleName={`Row ${i + 1} code`} value={row.code} maxLength={20} onChange={(v) => edit(row.key, "code", v)} error={rowErrors[row.key]?.code} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-6"
              aria-label={`Remove row ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((c) => [...c, newRow()])} disabled={rows.length >= MAX_BULK_SUBJECTS}>
          <Plus /> Add row
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
        <PendingButton type="submit" pending={pending} disabled={filled === 0}>
          {filled > 0 ? `Add ${plural(filled, "subject")}` : "Add subjects"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
