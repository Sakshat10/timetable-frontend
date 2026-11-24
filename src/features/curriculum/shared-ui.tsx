"use client";

import { useId, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/format";

/**
 * A compact labelled input for row editors (bulk dialogs, curriculum lines). `label` is visible;
 * `accessibleName` (e.g. "Grade 2 section 1 code") disambiguates repeated rows for assistive technology.
 */
export function RowField({
  label,
  accessibleName,
  value,
  onChange,
  error,
  className,
  inputMode,
  maxLength,
  placeholder,
  disabled,
  type = "text",
}: {
  label: string;
  accessibleName: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  type?: "text" | "number";
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        aria-label={accessibleName}
        value={value}
        type={type}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(type === "number" && "tabular")}
      />
      {error ? <FieldMessage id={`${id}-error`}>{error}</FieldMessage> : null}
    </div>
  );
}

export function FieldMessage({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-destructive">
      {children}
    </p>
  );
}

/** Warns that setup changes make existing timetable drafts out of date (stale) until they are generated again. */
export function DraftsNotice({ count, what }: { count: number; what: string }) {
  if (count === 0) return null;
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-2.5 text-sm text-warning-foreground dark:text-warning">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        This year has {plural(count, "timetable draft")}. Changing {what} makes {count === 1 ? "it" : "them"} out of date:{" "}
        {count === 1 ? "it" : "they"} can’t be published until {count === 1 ? "it is" : "they are"} generated again.
      </p>
    </div>
  );
}

/** A neutral explanatory note. */
export function InfoNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-muted-foreground", className)}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  );
}
