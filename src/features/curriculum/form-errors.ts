/**
 * Helpers shared by the Classes, Subjects and Curriculum forms for attaching server messages to inputs.
 * Bulk endpoints key their messages by request path ("grades.0.sections.1.code", "subjects.2.code",
 * "requirements.3.periodsPerWeek"); single-record 409 conflicts carry only a message.
 */
import type { FieldPath, FieldValues, UseFormSetError } from "react-hook-form";
import { applyServerErrors } from "@/components/shared/form-fields";
import { isApiError } from "@/lib/api/errors";

/** Path → first message. */
export type PathErrors = Record<string, string>;

/**
 * Splits server field errors into messages for paths the form renders and leftovers (shown in a FormAlert).
 * Ajv messages arrive under "_form" and always end up in leftovers.
 */
export function splitServerErrors(error: unknown, isKnownPath: (path: string) => boolean): { byPath: PathErrors; leftovers: string[] } {
  const byPath: PathErrors = {};
  const leftovers: string[] = [];
  if (!isApiError(error)) return { byPath, leftovers };
  for (const [path, messages] of Object.entries(error.fieldErrors)) {
    if (messages.length === 0) continue;
    if (isKnownPath(path)) byPath[path] = messages[0];
    else leftovers.push(...messages);
  }
  return { byPath, leftovers };
}

/**
 * Which field a single-record 409 conflict is about. The backend's conflict messages name the field
 * ("Subject with code \"MATH\" already exists…", "Display order 3 is already used…", "Grade \"8\" already exists…")
 * but carry no field key, so the message is matched against the fields the form has.
 */
export function conflictField<F extends string>(message: string, fields: readonly F[]): F | null {
  const has = (f: string) => (fields as readonly string[]).includes(f);
  if (/display order/i.test(message) && has("displayOrder")) return "displayOrder" as F;
  if (/\bcode\b/i.test(message) && has("code")) return "code" as F;
  if (/already (exists|used)/i.test(message) && has("name")) return "name" as F;
  return null;
}

/** "a.b.c" for a path array. */
export const joinPath = (path: ReadonlyArray<string | number>) => path.join(".");

/**
 * Standard handling of a failed single-record form submit: Zod field errors and 409 conflicts go onto their
 * fields; anything else is returned as a form-level message (for a FormAlert).
 */
export function formErrorMessage<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string | null {
  const leftovers = applyServerErrors(error, setError, fields);
  if (isApiError(error) && error.isConflict && Object.keys(error.fieldErrors).length === 0) {
    const field = conflictField(error.message, fields);
    if (field) {
      setError(field as FieldPath<T>, { type: "server", message: error.message });
      return null;
    }
  }
  if (leftovers.length > 0) return leftovers.join(" ");
  if (isApiError(error) && Object.keys(error.fieldErrors).length > 0) return null;
  return isApiError(error) ? error.message : "Something went wrong. Please try again.";
}
