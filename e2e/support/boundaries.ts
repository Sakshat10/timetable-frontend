import type { Page } from "@playwright/test";

/**
 * CAPABILITY-BOUNDARIES.md §1: words that must not appear as the accessible name of any interactive control.
 * Supported look-alikes are allow-listed (e.g. "Cancel" in dialogs, "Cancel absence", "Cancel cover").
 */
export const FORBIDDEN_CONTROL_NAMES: RegExp[] = [
  /cancel generation|stop generation|abort/i, // X1
  /\bunpublish|take offline/i, // X3
  /\barchive\b|\brestore\b|roll ?back|revert to/i, // X4 ("Archived" badges are not controls)
  /change teacher|reassign teacher/i, // X5 (cover assignment uses "Assign"/"Use … instead")
  /add lesson|delete lesson|remove lesson/i, // X6
  /move to class|move to section/i, // X7
  /\bexport\b|\bdownload\b|\bcsv\b|\bpdf\b|print timetable/i, // X8
  /workload|load summary|teacher hours/i, // X9
  /audit log|activity log|change history/i, // X10
  /time ?zone/i, // X11
  /forgot password|reset password|change password/i, // X12
  /school code/i, // X13 (login uses School ID)
];

const INTERACTIVE_ROLES = ["button", "link", "menuitem", "tab", "option", "menuitemradio", "menuitemcheckbox"] as const;

/** Returns the accessible names of interactive controls that match a forbidden pattern. */
export async function forbiddenControls(page: Page): Promise<string[]> {
  const offenders: string[] = [];
  for (const role of INTERACTIVE_ROLES) {
    const names = await page.getByRole(role).evaluateAll((elements) =>
      elements
        .filter((el) => (el as HTMLElement).offsetParent !== null || el.getAttribute("role") === "option")
        .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    for (const name of names) if (FORBIDDEN_CONTROL_NAMES.some((rx) => rx.test(name))) offenders.push(`${role}: ${name}`);
  }
  return offenders;
}
