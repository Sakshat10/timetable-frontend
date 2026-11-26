"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateLong, isIsoDate } from "@/lib/dates";
import { nextDay, previousDay, relationToToday } from "../board-rules";

/** Day navigation on the server's UTC calendar (X11: no time-zone setting). */
export function DateNavigator({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  const inputId = useId();
  const relation = relationToToday(date, today);
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-surface shadow-card p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-foreground" aria-live="polite">
            Showing {formatDateLong(date)}
          </h2>
          {relation === "today" ? <StatusBadge tone="accent">Today</StatusBadge> : relation === "past" ? <StatusBadge tone="neutral">Past date</StatusBadge> : null}
        </div>
        <p className="text-xs text-muted-foreground">Dates follow the server’s calendar (UTC), so a new day starts at midnight UTC.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => onChange(previousDay(date))}>
          <ChevronLeft />
        </Button>
        <label htmlFor={inputId} className="sr-only">
          Date
        </label>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={inputId}
            type="date"
            className="w-44 pl-8"
            value={date}
            onChange={(e) => {
              if (isIsoDate(e.target.value)) onChange(e.target.value);
            }}
          />
        </div>
        <Button variant="outline" size="icon" aria-label="Next day" onClick={() => onChange(nextDay(date))}>
          <ChevronRight />
        </Button>
        <Button variant="outline" onClick={() => onChange(today)} disabled={date === today}>
          Today (UTC)
        </Button>
      </div>
    </div>
  );
}
