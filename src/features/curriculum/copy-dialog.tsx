"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FormAlert } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { curriculumApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { CopyCurriculumResult, CurriculumOverview } from "@/lib/api/schemas";
import { notifyError, notifySuccess } from "@/lib/notify";
import { plural } from "@/lib/format";
import { COPY_SKIP_REASON, copySources, type GroupRef } from "./rules";

export interface CopyTarget extends GroupRef {
  label: string;
}

export function CopyCurriculumDialog({
  target,
  overview,
  onClose,
  invalidate,
}: {
  target: CopyTarget | null;
  overview: CurriculumOverview | undefined;
  onClose: () => void;
  invalidate: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {target && overview ? <CopyBody target={target} overview={overview} onClose={onClose} invalidate={invalidate} pending={pending} setPending={setPending} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CopyBody({
  target,
  overview,
  onClose,
  invalidate,
  pending,
  setPending,
}: {
  target: CopyTarget;
  overview: CurriculumOverview;
  onClose: () => void;
  invalidate: () => Promise<void>;
  pending: boolean;
  setPending: (p: boolean) => void;
}) {
  const sources = copySources(overview, target);
  const [sourceId, setSourceId] = useState("");
  const [preview, setPreview] = useState<CopyCurriculumResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = sources.find((s) => s.id === sourceId);

  async function run(dryRun: boolean) {
    if (!source || pending) return;
    setError(null);
    setPending(true);
    try {
      const result = await curriculumApi.copy({
        fromGradeId: source.gradeId,
        ...(source.streamId ? { fromStreamId: source.streamId } : {}),
        toGradeId: target.gradeId,
        ...(target.streamId ? { toStreamId: target.streamId } : {}),
        dryRun,
      });
      setPending(false);
      if (dryRun) {
        setPreview(result);
        return;
      }
      await invalidate();
      notifySuccess(`Copied ${plural(result.created.length, "subject")} into ${target.label}`, `From ${source.label}`);
      onClose();
    } catch (e) {
      setPending(false);
      if (isApiError(e) && e.uncertain) {
        await invalidate();
        notifyError(e);
        onClose();
        return;
      }
      setPreview(null);
      setError(isApiError(e) ? e.message : "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Copy curriculum into {target.label}</DialogTitle>
        <DialogDescription>
          Adds the source’s subjects with their periods and optional label. Subjects {target.label} already has are kept as they are, and subjects limited to selected sections
          are not copied. You’ll see what will be added before anything is saved.
        </DialogDescription>
      </DialogHeader>
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other grade or stream in this year has a curriculum to copy yet.</p>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="copy-source">Copy from</Label>
          <Select
            value={sourceId}
            onValueChange={(v) => {
              setSourceId(v);
              setPreview(null);
              setError(null);
            }}
          >
            <SelectTrigger id="copy-source" className="w-full">
              <SelectValue placeholder="Choose a grade or stream" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label} ({plural(s.subjectCount, "subject")})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {preview ? (
        <div className="space-y-3 text-sm" aria-live="polite">
          {preview.created.length > 0 ? (
            <section className="space-y-1.5" aria-label="Subjects that will be added">
              <h3 className="font-semibold text-foreground">Will be added ({preview.created.length})</h3>
              <ul className="divide-y rounded-lg border">
                {preview.created.map((c) => (
                  <li key={c.subject.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium text-foreground">{c.subject.name}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      {plural(c.periodsPerWeek, "period")} a week
                      {c.isOptional ? <StatusBadge tone="neutral">Optional</StatusBadge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-muted-foreground">Nothing would be added.</p>
          )}
          {preview.skipped.length > 0 ? (
            <section className="space-y-1.5" aria-label="Subjects that will not be copied">
              <h3 className="font-semibold text-foreground">Not copied ({preview.skipped.length})</h3>
              <ul className="divide-y rounded-lg border">
                {preview.skipped.map((s) => (
                  <li key={s.subject.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="font-medium text-foreground">{s.subject.name}</span>
                    <span className="text-muted-foreground">{COPY_SKIP_REASON[s.reason] ?? s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {preview.created.length > 0 ? <p className="text-muted-foreground">Copying makes existing timetable drafts of this year out of date until they are generated again.</p> : null}
        </div>
      ) : null}

      <FormAlert>{error}</FormAlert>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {preview ? (
          <PendingButton onClick={() => void run(false)} pending={pending} disabled={preview.created.length === 0}>
            Copy {plural(preview.created.length, "subject")}
          </PendingButton>
        ) : (
          <PendingButton onClick={() => void run(true)} pending={pending} disabled={!source}>
            Review copy
          </PendingButton>
        )}
      </DialogFooter>
    </div>
  );
}
