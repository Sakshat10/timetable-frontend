"use client";

import { toast } from "sonner";
import { isApiError } from "@/lib/api/errors";

/**
 * Notification conventions:
 * - success: short confirmation of what was saved.
 * - error: one toast per distinct message (deduplicated by id), never for 401 (the session
 *   handler shows a single "session ended" notice), and never with raw server internals.
 */
export function notifySuccess(message: string, description?: string) {
  toast.success(message, { description });
}

export function notifyError(error: unknown, fallbackTitle = "Couldn’t save the change") {
  if (isApiError(error) && error.isUnauthorized) return;
  const message = isApiError(error) ? error.message : "Something went wrong. Please try again.";
  const uncertain = isApiError(error) && error.uncertain;
  toast.error(fallbackTitle, {
    id: `error:${fallbackTitle}:${message}`,
    description: uncertain ? `${message} The change may or may not have been saved; the page has been refreshed to show the current state.` : message,
  });
}

export function notifyInfo(message: string, description?: string) {
  toast(message, { description });
}
