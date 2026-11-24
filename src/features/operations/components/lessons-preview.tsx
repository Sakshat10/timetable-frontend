"use client";

import { CalendarRange } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateLong, isIsoDate, weekdayOf } from "@/lib/dates";
import { DAY_LABEL, sectionLabel } from "@/lib/format";
import { yearsContaining } from "../board-rules";
import { useTeacherView, useYears, useYearVersions } from "../hooks";

/**
 * Optional preview for a single-day absence (FEATURE-API-MATRIX M12): the teacher's lessons on that weekday in the
 * published version of the DRAFT/ACTIVE year containing the date. The server still decides the real cover requests.
 */
export function LessonsPreview({ teacherId, date, fromPeriod, toPeriod }: { teacherId: string; date: string; fromPeriod?: number; toPeriod?: number }) {
  const valid = Boolean(teacherId) && isIsoDate(date);
  const years = useYears();
  const matches = valid && years.data ? yearsContaining(years.data, date) : [];
  const yearId = matches.length === 1 ? matches[0]!.id : null;
  const versions = useYearVersions(yearId);
  const published = versions.data?.find((v) => v.status === "PUBLISHED") ?? null;
  const view = useTeacherView(published?.id ?? null, valid ? teacherId : null);

  if (!valid) return null;

  let body: React.ReactNode;
  if (years.isPending || (yearId && versions.isPending) || (published && view.isPending)) {
    body = (
      <div className="space-y-1.5" aria-busy="true" aria-label="Loading lessons">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  } else if (years.isError || versions.isError || view.isError) {
    body = <p className="text-muted-foreground">The preview isn’t available right now. The server will still work out the affected lessons when you save.</p>;
  } else if (matches.length === 0) {
    body = <p className="text-muted-foreground">No draft or active academic year contains this date, so no cover will be created.</p>;
  } else if (matches.length > 1) {
    body = <p className="text-muted-foreground">This date falls inside two academic years, so the server won’t create cover for it.</p>;
  } else if (!published) {
    body = <p className="text-muted-foreground">No published timetable for this date, so no cover will be created.</p>;
  } else {
    const weekday = weekdayOf(date);
    const lessons = (view.data?.cells ?? [])
      .filter((cell) => cell.dayOfWeek === weekday && cell.lesson !== null)
      .filter((cell) => (fromPeriod === undefined || cell.periodNumber >= fromPeriod) && (toPeriod === undefined || cell.periodNumber <= toPeriod))
      .sort((a, b) => a.periodNumber - b.periodNumber);
    body =
      lessons.length === 0 ? (
        <p className="text-muted-foreground">No lessons on {DAY_LABEL[weekday]} in the published timetable{fromPeriod !== undefined ? " for these periods" : ""}.</p>
      ) : (
        <ul className="space-y-1">
          {lessons.map((cell) => (
            <li key={cell.periodNumber} className="flex gap-2">
              <span className="tabular w-8 shrink-0 font-medium text-foreground">P{cell.periodNumber}</span>
              <span className="text-foreground">
                {sectionLabel(cell.lesson!.section.gradeName, cell.lesson!.section.name ?? "Class")} · {cell.lesson!.subject.name ?? "Subject"}
              </span>
            </li>
          ))}
        </ul>
      );
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarRange className="size-3.5" aria-hidden />
        Lessons from the published timetable · {formatDateLong(date)}
      </p>
      {body}
    </div>
  );
}
