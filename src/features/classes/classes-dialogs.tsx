"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { FormAlert, NumberField, SelectField, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { gradesApi, sectionsApi, streamsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { CurriculumGrade } from "@/lib/api/schemas";
import { notifyError, notifySuccess } from "@/lib/notify";
import { formErrorMessage } from "@/features/curriculum/form-errors";

type Invalidate = () => Promise<void>;

/** Uncertain writes are never re-sent: refresh, close and tell the user to check (IMPLEMENTATION-GUIDE "Data access"). */
async function handleUncertain(error: unknown, invalidate: Invalidate, close: () => void): Promise<boolean> {
  if (isApiError(error) && error.uncertain) {
    await invalidate();
    notifyError(error);
    close();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ grade

const gradeSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters"),
  displayOrder: z.number({ error: "Enter a display order" }).int("Use a whole number").min(1, "Use 1 or more"),
});
type GradeValues = z.infer<typeof gradeSchema>;

export function GradeDialog({
  open,
  onOpenChange,
  yearId,
  grade,
  suggestedOrder,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  yearId: string;
  /** Edit when given, create otherwise. */
  grade?: CurriculumGrade;
  suggestedOrder: number;
  invalidate: Invalidate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <GradeForm yearId={yearId} grade={grade} suggestedOrder={suggestedOrder} invalidate={invalidate} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function GradeForm({ yearId, grade, suggestedOrder, invalidate, close }: { yearId: string; grade?: CurriculumGrade; suggestedOrder: number; invalidate: Invalidate; close: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GradeValues>({
    resolver: zodResolver(gradeSchema),
    defaultValues: { name: grade?.name ?? "", displayOrder: grade?.displayOrder ?? suggestedOrder },
  });

  async function onSubmit(values: GradeValues) {
    setFormError(null);
    try {
      if (grade) {
        const body: { name?: string; displayOrder?: number } = {};
        if (values.name !== grade.name) body.name = values.name;
        if (values.displayOrder !== grade.displayOrder) body.displayOrder = values.displayOrder;
        if (Object.keys(body).length > 0) await gradesApi.update(grade.id, body);
      } else {
        await gradesApi.create({ academicYearId: yearId, name: values.name, displayOrder: values.displayOrder });
      }
      await invalidate();
      notifySuccess(grade ? "Grade updated" : "Grade added", values.name);
      close();
    } catch (error) {
      if (await handleUncertain(error, invalidate, close)) return;
      setFormError(formErrorMessage(error, form.setError, ["name", "displayOrder"]));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{grade ? "Edit grade" : "Add grade"}</DialogTitle>
        <DialogDescription>Display order sets where the grade appears in lists (1 comes first). Names and orders are unique within the year.</DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="name" label="Grade name" placeholder="e.g. Grade 6" autoFocus maxLength={100} />
        <NumberField control={form.control} name="displayOrder" label="Display order" min={1} />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={form.formState.isSubmitting}>
          {grade ? "Save grade" : "Add grade"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}

// ------------------------------------------------------------------ stream

const codeSchema = z.string().trim().min(1, "Enter a code").max(20, "Use at most 20 characters");
const streamSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters"), code: codeSchema });
type StreamValues = z.infer<typeof streamSchema>;

export interface StreamRef {
  id: string;
  name: string;
  code: string;
}

export function StreamDialog({
  open,
  onOpenChange,
  grade,
  stream,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: CurriculumGrade | null;
  stream?: StreamRef;
  invalidate: Invalidate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && grade ? <StreamForm grade={grade} stream={stream} invalidate={invalidate} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function StreamForm({ grade, stream, invalidate, close }: { grade: CurriculumGrade; stream?: StreamRef; invalidate: Invalidate; close: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<StreamValues>({ resolver: zodResolver(streamSchema), defaultValues: { name: stream?.name ?? "", code: stream?.code ?? "" } });

  async function onSubmit(values: StreamValues) {
    setFormError(null);
    try {
      if (stream) {
        const body: { name?: string; code?: string } = {};
        if (values.name !== stream.name) body.name = values.name;
        if (values.code.toUpperCase() !== stream.code) body.code = values.code;
        if (Object.keys(body).length > 0) await streamsApi.update(stream.id, body);
      } else {
        await streamsApi.create({ gradeId: grade.id, name: values.name, code: values.code });
      }
      await invalidate();
      notifySuccess(stream ? "Stream updated" : "Stream added", `${grade.name} · ${values.name}`);
      close();
    } catch (error) {
      if (await handleUncertain(error, invalidate, close)) return;
      setFormError(formErrorMessage(error, form.setError, ["name", "code"]));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{stream ? "Edit stream" : `Add stream to ${grade.name}`}</DialogTitle>
        <DialogDescription>
          {stream
            ? "Stream codes are unique within the grade and saved in capitals."
            : "Once a grade has streams, every section of it belongs to one stream, and its curriculum is set per stream."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="name" label="Stream name" placeholder="e.g. Science" autoFocus maxLength={100} />
        <TextField control={form.control} name="code" label="Stream code" placeholder="e.g. SCI" maxLength={20} />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={form.formState.isSubmitting}>
          {stream ? "Save stream" : "Add stream"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}

// ------------------------------------------------------------------ section

export interface SectionRef {
  id: string;
  name: string;
  code: string;
}

export function SectionDialog({
  open,
  onOpenChange,
  grade,
  needsStream,
  defaultStreamId,
  section,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: CurriculumGrade | null;
  /** The grade uses streams, so a new section must name one. */
  needsStream: boolean;
  defaultStreamId?: string | null;
  section?: SectionRef;
  invalidate: Invalidate;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && grade ? (
          <SectionForm grade={grade} needsStream={needsStream} defaultStreamId={defaultStreamId ?? null} section={section} invalidate={invalidate} close={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SectionForm({
  grade,
  needsStream,
  defaultStreamId,
  section,
  invalidate,
  close,
}: {
  grade: CurriculumGrade;
  needsStream: boolean;
  defaultStreamId: string | null;
  section?: SectionRef;
  invalidate: Invalidate;
  close: () => void;
}) {
  const askStream = !section && needsStream;
  const schema = z.object({
    name: z.string().trim().min(1, "Enter a name").max(100, "Use at most 100 characters"),
    code: codeSchema,
    streamId: askStream ? z.string().min(1, "Choose the stream this section belongs to") : z.string().optional(),
  });
  type Values = z.infer<typeof schema>;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: section?.name ?? "", code: section?.code ?? "", streamId: defaultStreamId ?? (grade.streams.length === 1 ? grade.streams[0].id : "") },
  });

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      if (section) {
        const body: { name?: string; code?: string } = {};
        if (values.name !== section.name) body.name = values.name;
        if (values.code !== section.code) body.code = values.code;
        if (Object.keys(body).length > 0) await sectionsApi.update(section.id, body);
      } else {
        await sectionsApi.create({ gradeId: grade.id, name: values.name, code: values.code, ...(askStream && values.streamId ? { streamId: values.streamId } : {}) });
      }
      await invalidate();
      notifySuccess(section ? "Section updated" : "Section added", `${grade.name} · ${values.name}`);
      close();
    } catch (error) {
      if (await handleUncertain(error, invalidate, close)) return;
      setFormError(formErrorMessage(error, form.setError, ["name", "code", "streamId"]));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{section ? "Edit section" : `Add section to ${grade.name}`}</DialogTitle>
        <DialogDescription>
          {section
            ? "A section’s stream can’t be changed. To move it, add a new section in the other stream."
            : askStream
              ? "This grade uses streams, so the section must belong to one of them."
              : "Sections are the classes a timetable is made for."}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        {askStream ? (
          <SelectField
            control={form.control}
            name="streamId"
            label="Stream"
            placeholder="Choose a stream"
            options={grade.streams.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
          />
        ) : null}
        <TextField control={form.control} name="name" label="Section name" placeholder="e.g. Section A" autoFocus maxLength={100} />
        <TextField control={form.control} name="code" label="Section code" placeholder="e.g. A" maxLength={20} />
      </FieldGroup>
      <FormAlert>{formError}</FormAlert>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancel
        </Button>
        <PendingButton type="submit" pending={form.formState.isSubmitting}>
          {section ? "Save section" : "Add section"}
        </PendingButton>
      </DialogFooter>
    </form>
  );
}
