"use client";

import { useId, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Extra content: consequences, lists. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** The user must type this exact text before confirming (irreversible actions). */
  typedConfirmation?: string;
  /** Runs the action. The dialog stays open (with a spinner) until it settles; it closes on success. */
  onConfirm: () => Promise<unknown>;
  /** Shown inside the dialog when onConfirm throws (in addition to any caller handling). */
  errorRender?: (error: unknown) => ReactNode;
}

/**
 * The single confirmation pattern. Prevents duplicate submission, keeps focus inside, and supports
 * typed confirmation for irreversible actions (CAPABILITY-BOUNDARIES.md: academic-year activation).
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onOpenChange } = props;
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      {/* The body mounts on every open, so its typed text, error and pending state always start fresh. */}
      {open ? <ConfirmBody {...props} onPendingChange={setPending} /> : null}
    </AlertDialog>
  );
}

function ConfirmBody({
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  typedConfirmation,
  onConfirm,
  errorRender,
  onPendingChange,
}: ConfirmDialogProps & { onPendingChange: (pending: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const [pending, setPendingState] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputId = useId();
  const typedOk = typedConfirmation === undefined || typed.trim() === typedConfirmation;

  function setPending(value: boolean) {
    setPendingState(value);
    onPendingChange(value);
  }

  async function run() {
    if (pending || !typedOk) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
      onOpenChange(false);
    } catch (e) {
      setError(e);
      setPending(false);
    }
  }

  return (
    <AlertDialogContent className="sm:max-w-lg">
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description ? (
          <AlertDialogDescription asChild>
            <div>{description}</div>
          </AlertDialogDescription>
        ) : null}
      </AlertDialogHeader>
      {children ? <div className="space-y-3 text-sm">{children}</div> : null}
      {typedConfirmation !== undefined ? (
        <div className="space-y-1.5">
          <Label htmlFor={inputId} className="text-sm font-normal">
            Type <span className="font-semibold text-foreground">{typedConfirmation}</span> to confirm
          </Label>
          <Input
            id={inputId}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
          />
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
          {errorRender ? errorRender(error) : isApiError(error) ? error.message : "Something went wrong. Please try again."}
        </div>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
        <Button
          variant={destructive ? "destructive" : "default"}
          className={cn(destructive && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
          disabled={!typedOk || pending}
          onClick={() => void run()}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

/** Renders `errors.blockedBy` from a dependency-checked delete (record-deletion module) as a list. */
export function BlockedByList({ error }: { error: unknown }) {
  if (!isApiError(error)) return <>Something went wrong. Please try again.</>;
  const blockedBy = Array.isArray(error.details.blockedBy) ? (error.details.blockedBy as string[]) : [];
  if (blockedBy.length === 0) return <>{error.message}</>;
  return (
    <div className="space-y-1.5">
      <p>This can’t be deleted yet because it is still in use:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {blockedBy.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

/** Standard dependency-checked delete confirmation. */
export function DeleteRecordDialog({
  open,
  onOpenChange,
  what,
  name,
  consequence,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "subject" */
  what: string;
  name: string;
  consequence?: ReactNode;
  onDelete: () => Promise<unknown>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete ${what}?`}
      description={
        <>
          <span className="font-medium text-foreground">{name}</span> will be permanently deleted. The server checks that nothing depends on it first.
        </>
      }
      confirmLabel={`Delete ${what}`}
      destructive
      onConfirm={onDelete}
      errorRender={(error) => <BlockedByList error={error} />}
    >
      {consequence}
    </ConfirmDialog>
  );
}

/** Button that shows a spinner and blocks repeat clicks while pending. */
export function PendingButton({
  pending,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}
