"use client";

import { useId, type ReactNode } from "react";
import { Controller, type Control, type FieldPath, type FieldValues, type UseFormSetError } from "react-hook-form";
import { AlertCircle } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { isApiError } from "@/lib/api/errors";

interface BaseProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  type = "text",
  placeholder,
  autoComplete,
  autoFocus,
  inputMode,
  maxLength,
}: BaseProps<T> & {
  type?: "text" | "email" | "password" | "date" | "search";
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
}) {
  const uid = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={uid}>{label}</FieldLabel>
          <Input
            {...field}
            value={(field.value as string | undefined) ?? ""}
            id={uid}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            inputMode={inputMode}
            maxLength={maxLength}
            disabled={disabled}
            aria-invalid={fieldState.invalid || undefined}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function TextAreaField<T extends FieldValues>({ control, name, label, description, disabled, className, placeholder, rows = 3 }: BaseProps<T> & { placeholder?: string; rows?: number }) {
  const uid = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={uid}>{label}</FieldLabel>
          <Textarea {...field} value={(field.value as string | undefined) ?? ""} id={uid} rows={rows} placeholder={placeholder} disabled={disabled} aria-invalid={fieldState.invalid || undefined} />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

/** Integer input bound to a number in form state (empty -> undefined). */
export function NumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  min,
  max,
}: BaseProps<T> & { min?: number; max?: number }) {
  const uid = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={uid}>{label}</FieldLabel>
          <Input
            id={uid}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            disabled={disabled}
            value={field.value === undefined || field.value === null || Number.isNaN(field.value) ? "" : String(field.value)}
            onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            aria-invalid={fieldState.invalid || undefined}
            className="tabular"
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export interface Option {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  disabled,
  className,
  options,
  placeholder = "Select…",
}: BaseProps<T> & { options: Option[]; placeholder?: string }) {
  const uid = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid || undefined} className={className}>
          <FieldLabel htmlFor={uid}>{label}</FieldLabel>
          <Select value={(field.value as string | undefined) ?? ""} onValueChange={field.onChange} disabled={disabled}>
            <SelectTrigger id={uid} className="w-full" aria-invalid={fieldState.invalid || undefined} onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

export function CheckboxField<T extends FieldValues>({ control, name, label, description, disabled, className }: BaseProps<T>) {
  const uid = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field orientation="horizontal" data-invalid={fieldState.invalid || undefined} className={className}>
          <Checkbox id={uid} checked={Boolean(field.value)} onCheckedChange={(v) => field.onChange(v === true)} disabled={disabled} />
          <div className="space-y-0.5">
            <FieldLabel htmlFor={uid} className="font-normal">
              {label}
            </FieldLabel>
            {description ? <FieldDescription>{description}</FieldDescription> : null}
          </div>
        </Field>
      )}
    />
  );
}

/**
 * Copies server field errors (Zod paths such as "name" or "requirements.2.periodsPerWeek") onto form fields.
 * `pathMap` renames server paths to form paths. Returns the messages that matched no field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  pathMap: Record<string, string> = {},
): string[] {
  if (!isApiError(error)) return [];
  const leftovers: string[] = [];
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    const target = pathMap[path] ?? path;
    if (knownFields.includes(target)) {
      setError(target as FieldPath<T>, { type: "server", message: messages[0] });
    } else {
      leftovers.push(...messages);
    }
  }
  return leftovers;
}

/** A form-level error banner. */
export function FormAlert({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive-muted px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">{children}</div>
    </div>
  );
}
