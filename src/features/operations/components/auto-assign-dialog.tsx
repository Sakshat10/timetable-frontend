"use client";

import { useId, useRef, useState } from "react";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { FormAlert } from "@/components/shared/form-fields";
import { ReadOnlyNotice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { errorMessage, isApiError } from "@/lib/api/errors";
import type { AutoRun } from "@/lib/api/schemas";
import { formatDateLong } from "@/lib/dates";
import { notifyError } from "@/lib/notify";
import { useAutoAssignRange } from "../hooks";
import { AutoRunFacts } from "./allocation-notice";

/** POST /substitutions/auto-assign for one day (idempotent: it only fills lessons that still need cover). */
export function AutoAssignDialog({ open, onOpenChange, date, isPast }: { open: boolean; onOpenChange: (open: boolean) => void; date: string; isPast: boolean }) {
  const run = useAutoAssignRange();
  const inFlight = useRef(false);
  const [allowTemporaryCover, setAllowTemporaryCover] = useState(true);
  const [result, setResult] = useState<AutoRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();

  function close(next: boolean) {
    if (run.isPending) return;
    onOpenChange(next);
    if (!next) {
      setResult(null);
      setError(null);
    }
  }

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const response = await run.mutateAsync({ from: date, to: date, allowTemporaryCover });
      setResult(response.run);
    } catch (e) {
      if (isApiError(e) && e.uncertain) {
        notifyError(e, "Couldn’t confirm the automatic assignment");
        close(false);
      } else setError(errorMessage(e));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign substitutes automatically</DialogTitle>
          <DialogDescription>
            For {formatDateLong(date)}. The server picks substitutes for lessons that still need cover. Lessons that already have a substitute are never changed.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">Automatic assignment finished.</p>
            <AutoRunFacts run={result} />
            {result.skippedPast > 0 ? <p className="text-xs text-muted-foreground">Past dates are never assigned automatically. Assign those lessons by hand.</p> : null}
          </div>
        ) : isPast ? (
          <ReadOnlyNotice>This date has passed. Past dates are never assigned automatically; open a lesson to assign a substitute by hand.</ReadOnlyNotice>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              <Checkbox id={checkboxId} checked={allowTemporaryCover} onCheckedChange={(v) => setAllowTemporaryCover(v === true)} disabled={run.isPending} />
              <div className="space-y-0.5">
                <Label htmlFor={checkboxId} className="font-normal">
                  Allow temporary (unqualified) cover
                </Label>
                <p className="text-xs text-muted-foreground">A free teacher who doesn’t teach the subject may cover a lesson for that day only.</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Past dates are never assigned automatically.</p>
            {error ? <FormAlert>{error}</FormAlert> : null}
          </div>
        )}
        <DialogFooter>
          {result || isPast ? (
            <Button onClick={() => close(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)} disabled={run.isPending}>
                Close
              </Button>
              <PendingButton pending={run.isPending} onClick={() => void start()}>
                Assign automatically
              </PendingButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
