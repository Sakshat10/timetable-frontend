"use client";

import type { ReactNode } from "react";
import { AlertTriangle, CloudOff, Inbox, Lock, RefreshCw, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

/** An empty state that tells the user what to do next. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  compact,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed bg-surface text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <div className="mx-auto max-w-md text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function NoResults({ query, onClear }: { query?: string; onClear?: () => void }) {
  return (
    <EmptyState
      compact
      icon={<SearchX className="size-5" />}
      title={query ? `No results for “${query}”` : "No matching results"}
      description="Try a different search or clear the filters."
      action={
        onClear ? (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : null
      }
    />
  );
}

/** A load failure with a retry. Never shows raw server text for 5xx (ApiError already sanitises). */
export function ErrorState({
  error,
  title,
  message: messageOverride,
  onRetry,
  className,
  compact,
}: {
  error?: unknown;
  title?: string;
  /** Plain message (use from Server Components, which cannot pass error instances). */
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const network = isApiError(error) && error.isNetwork;
  const notFound = isApiError(error) && error.isNotFound;
  const message = messageOverride ?? (notFound
    ? "It may have been removed, or the link is wrong."
    : isApiError(error)
      ? error.message
      : "Something went wrong while loading this. Please try again.");
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border bg-surface text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive-muted text-destructive" aria-hidden>
        {network ? <CloudOff className="size-5" /> : <AlertTriangle className="size-5" />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title ?? (notFound ? "Not found" : "Couldn’t load this")}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && !notFound ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Explains why a real capability is disabled in the current context (e.g. the year is not DRAFT). */
export function ReadOnlyNotice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border bg-muted/60 px-3.5 py-2.5 text-sm text-muted-foreground", className)}>
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** A non-blocking notice shown when a background refresh failed but data is still displayed. */
export function StaleDataNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-muted px-3 py-1.5 text-xs text-warning-foreground dark:text-warning">
      <AlertTriangle className="size-3.5" aria-hidden />
      Couldn’t refresh. Showing the last loaded information.
      {onRetry ? (
        <button type="button" className="ml-auto font-medium underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-surface" aria-busy="true" aria-label="Loading">
      <div className="flex gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 border-b px-4 py-3.5 last:border-b-0">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5 flex-1", c === 0 && "max-w-48")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-surface p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <TableSkeleton />
    </div>
  );
}
