"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Panel } from "@/components/shared/stat-card";
import { ErrorState } from "@/components/shared/states";
import { useYear } from "@/features/academic-years/year-context";
import { versionsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { PublishResult, Validation, VersionDetail, VersionSummary } from "@/lib/api/types";
import { DAY_SHORT, periodLabel } from "@/lib/format";
import { notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";
import { publishGate } from "./rules";

type Violation = { code?: string; message?: string; dayOfWeek?: keyof typeof DAY_SHORT; periodNumber?: number };

export function ValidationSummary({
  version,
  validation,
  error,
  isPending,
  onRetry,
}: {
  version: VersionDetail;
  validation: Validation | undefined;
  error: unknown;
  isPending: boolean;
  onRetry: () => void;
}) {
  if (isPending) return <Panel className="text-sm text-muted-foreground">Checking the timetable against the scheduling rules…</Panel>;
  if (error && !validation) {
    if (isApiError(error) && error.code === "SNAPSHOT_UNUSABLE") {
      return <Panel className="text-sm">This version can’t be validated: the setup snapshot stored with it can’t be read.</Panel>;
    }
    return <ErrorState compact error={error} title="Couldn’t check this version" onRetry={onRetry} />;
  }
  if (!validation) return null;
  const outdated = validation.revision !== version.revision;
  const violations = validation.violations as Violation[];
  return (
    <Panel className="flex flex-col gap-2" >
      <div className="flex items-center gap-2" role="status">
        {validation.valid ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <CircleAlert className="size-4 text-destructive" aria-hidden />}
        <h2 className="text-sm font-semibold">
          {validation.valid ? "No scheduling rule is broken" : `${validation.violationCount} scheduling rule violation${validation.violationCount === 1 ? "" : "s"}`}
        </h2>
        {outdated ? <span className="text-xs text-muted-foreground">(rechecking the latest changes…)</span> : null}
      </div>
      {validation.isStale ? (
        <p className="text-sm text-warning-foreground">
          The setup has changed since this version was generated, so it is out of date{version.status === "DRAFT" ? " and can’t be published. Generate a new draft." : "."}
        </p>
      ) : null}
      {violations.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {violations.slice(0, 50).map((v, i) => (
            <li key={`${v.code}-${i}`}>
              {v.message ?? v.code}
              {v.dayOfWeek && v.periodNumber ? <span className="text-muted-foreground"> ({DAY_SHORT[v.dayOfWeek]} {periodLabel(v.periodNumber)})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {validation.violationCount > violations.length ? <p className="text-xs text-muted-foreground">Showing the first {violations.length}.</p> : null}
    </Panel>
  );
}

function publishErrorText(error: unknown): { message: string; items?: string[] } {
  if (!isApiError(error)) return { message: "Something went wrong. Please try again." };
  switch (error.code) {
    case "PUBLISHED_CHANGED":
      return { message: "Another version was published meanwhile. The page has been refreshed; review it and publish again if this is still the right version." };
    case "STALE_CONFIGURATION":
      return { message: "The setup has changed since this draft was generated, so it can’t be published. Generate a new draft." };
    case "VALIDATION_FAILED": {
      const violations = Array.isArray(error.details.violations) ? (error.details.violations as Violation[]) : [];
      return { message: "The server found scheduling rule violations, so nothing was published.", items: violations.map((v) => v.message ?? v.code ?? "") };
    }
    case "REVISION_CONFLICT":
      return { message: "This draft was changed meanwhile. It has been reloaded; review it and publish again." };
    case "ACADEMIC_YEAR_NOT_EDITABLE":
      return { message: "This academic year is completed, so nothing can be published." };
    case "SNAPSHOT_UNUSABLE":
      return { message: "This draft’s stored setup snapshot can’t be read, so it can’t be published. Generate a new draft." };
    case "BUSY":
      return { message: `The server is busy with another change to this year. Try again in ${Math.ceil((error.retryAfterMs ?? 2_000) / 1000)} seconds.` };
    default:
      return { message: error.message };
  }
}

export function PublishPanel({ version, validation, versions }: { version: VersionDetail; validation: Validation | undefined; versions: VersionSummary[] | undefined }) {
  const { year, capabilities } = useYear();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const published = versions?.find((v) => v.status === "PUBLISHED") ?? null;
  const gate = publishGate({ version, validation, canPublish: capabilities.canPublish, publishedKnown: versions !== undefined });

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.versions(year.id) }),
      queryClient.invalidateQueries({ queryKey: qk.version(version.id) }),
      queryClient.invalidateQueries({ queryKey: qk.coversAll() }),
    ]);
  }

  async function publish() {
    try {
      const data = await versionsApi.publish(version.id, { expectedRevision: version.revision, expectedPublishedVersionId: published?.id ?? null });
      setResult(data);
      if (published) queryClient.removeQueries({ queryKey: qk.version(published.id) });
      await refreshAll();
      notifySuccess(`Version ${version.versionNumber} published`);
    } catch (error) {
      if (isApiError(error) && (error.uncertain || error.code === "VERSION_NOT_DRAFT")) {
        // After a lost answer, VERSION_NOT_DRAFT most likely means the publish succeeded: re-read and check.
        await refreshAll();
        const now = await queryClient.fetchQuery({ queryKey: qk.version(version.id), queryFn: () => versionsApi.get(version.id), staleTime: 0 }).catch(() => null);
        if (now?.status === "PUBLISHED") {
          notifySuccess(`Version ${version.versionNumber} is published`, "The server’s answer was lost, but the timetable shows as published.");
          return;
        }
        throw error;
      }
      if (isApiError(error) && ["PUBLISHED_CHANGED", "REVISION_CONFLICT", "STALE_CONFIGURATION", "VALIDATION_FAILED"].includes(error.code ?? "")) {
        await refreshAll();
      }
      throw error;
    }
  }

  if (result) return <PublishedNotice result={result} versionNumber={version.versionNumber} />;
  if (version.status !== "DRAFT") return null;

  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Publish</h2>
        <p className="text-sm text-muted-foreground">
          {gate.allowed
            ? published
              ? `Publishing makes this the school’s timetable. Version ${published.versionNumber}, published now, will be archived.`
              : "Publishing makes this the school’s timetable. No version is published yet."
            : gate.reason}
        </p>
      </div>
      <Button onClick={() => setOpen(true)} disabled={!gate.allowed} className="self-start sm:self-auto">
        <Send aria-hidden /> Publish version {version.versionNumber}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Publish version ${version.versionNumber}?`}
        description={
          published ? (
            <>
              Version {published.versionNumber} is published now. It will be <strong>archived</strong> and version {version.versionNumber} becomes the school’s timetable.
            </>
          ) : (
            <>Version {version.versionNumber} becomes the school’s timetable. No version is currently published.</>
          )
        }
        confirmLabel="Publish"
        onConfirm={publish}
        errorRender={(error) => {
          const text = publishErrorText(error);
          return (
            <div className="space-y-1">
              <p>{text.message}</p>
              {text.items?.length ? (
                <ul className="list-disc pl-5">
                  {text.items.slice(0, 20).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        }}
      >
        <p className="text-muted-foreground">Substitute cover for absences is updated automatically after publishing.</p>
      </ConfirmDialog>
    </Panel>
  );
}

function PublishedNotice({ result, versionNumber }: { result: PublishResult; versionNumber: number }) {
  const sub = result.substitution as { status?: string; run?: Record<string, number>; error?: string } | null;
  const run = sub?.run ?? {};
  return (
    <Panel className="flex flex-col gap-1.5" >
      <div role="status" className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-success" aria-hidden />
        <h2 className="text-sm font-semibold">Version {versionNumber} is now the published timetable</h2>
      </div>
      {sub?.status === "COMPLETED" ? (
        <p className="text-sm text-muted-foreground">
          Substitute cover was updated: {run.assigned ?? 0} lesson{run.assigned === 1 ? "" : "s"} reassigned, {run.unfilled ?? 0} need
          {run.unfilled === 1 ? "s" : ""} attention{run.heldForReview ? `, ${run.heldForReview} held for review` : ""}.{" "}
          <Link href="/operations" className="font-medium text-foreground underline underline-offset-2">
            Open daily operations
          </Link>
        </p>
      ) : sub?.status === "FAILED" ? (
        <p className="text-sm text-warning-foreground">
          The timetable was published, but substitute cover could not be updated automatically; open cover requests stay open.{" "}
          <Link href="/operations" className="font-medium underline underline-offset-2">
            Review cover in daily operations
          </Link>
        </p>
      ) : null}
    </Panel>
  );
}
