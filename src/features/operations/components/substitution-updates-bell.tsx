"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { substitutionEventsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { SubstitutionEvent } from "@/lib/api/schemas";
import { formatDateShort, formatRelative } from "@/lib/dates";
import { qk } from "@/lib/query/keys";
import { describeSubstitutionEvent } from "../substitution-event-text";

const POLL_MS = 30_000;
const OVERLAP_MS = 60_000;
const MAX_KEPT = 50;

/**
 * "Substitution updates" (CAPABILITY-BOUNDARIES P1): new substitution events since this page was opened,
 * from GET /api/substitution-events. It is not an activity or audit log and makes no completeness claim.
 *
 * Polling: starts at "now", then re-reads with a 60 s overlap window and de-duplicates by id, because an
 * event's timestamp is its transaction start and can be older than the previous poll (PHASE-0-AUDIT §6.5).
 */
export function SubstitutionUpdatesBell() {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<SubstitutionEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const since = useRef<string>(new Date().toISOString());
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      try {
        const from = new Date(new Date(since.current).getTime() - OVERLAP_MS).toISOString();
        const fresh: SubstitutionEvent[] = [];
        let cursor: string | undefined;
        let pageSince: string | undefined = from;
        for (let page = 0; page < 5; page++) {
          const result = await substitutionEventsApi.page(cursor ? { cursor, limit: 100 } : { since: pageSince, limit: 100 });
          for (const item of result.items) {
            if (!seen.current.has(item.id)) {
              seen.current.add(item.id);
              fresh.push(item);
            }
          }
          if (!result.hasMore || !result.nextCursor) break;
          cursor = result.nextCursor;
          pageSince = undefined;
        }
        if (cancelled) return;
        since.current = new Date().toISOString();
        if (fresh.length > 0) {
          setEvents((current) => [...fresh.reverse(), ...current].slice(0, MAX_KEPT));
          setUnread((count) => count + fresh.length);
          // Keep operational screens current when cover changes arrive.
          void queryClient.invalidateQueries({ queryKey: qk.coversAll() });
          void queryClient.invalidateQueries({ queryKey: qk.absencesAll() });
        }
      } catch (error) {
        if (isApiError(error) && error.isUnauthorized) return; // the session handler takes over
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    }

    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUnread(0);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Substitution updates, ${unread} new` : "Substitution updates"}>
          <Bell />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground" aria-hidden>
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Substitution updates</p>
          <p className="text-xs text-muted-foreground">Cover changes since you opened this page.</p>
        </div>
        {events.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No new substitution updates.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {events.map((event) => (
              <li key={event.id} className="px-4 py-2.5 text-sm">
                <p className="text-foreground">{describeSubstitutionEvent(event)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateShort(event.date)}
                  {event.periodNumber ? ` · Period ${event.periodNumber}` : ""} · {formatRelative(event.occurredAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-4 py-2">
          <Link href="/operations" className="text-xs font-medium text-primary hover:underline" onClick={() => setOpen(false)}>
            Open daily cover
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
