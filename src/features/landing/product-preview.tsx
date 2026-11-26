import { Check, UserRoundCheck } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * A static illustration of the product (sample data, not live). Built from markup so it stays sharp and light;
 * it is hidden from assistive technology and described by the figure caption instead.
 */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
type Tint = "blue" | "green" | "amber" | "violet" | "rose" | "teal";
const TINT: Record<Tint, string> = {
  blue: "bg-blue-50 text-blue-800 border-blue-200/70",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200/70",
  amber: "bg-amber-50 text-amber-800 border-amber-200/70",
  violet: "bg-violet-50 text-violet-800 border-violet-200/70",
  rose: "bg-rose-50 text-rose-800 border-rose-200/70",
  teal: "bg-teal-50 text-teal-800 border-teal-200/70",
};
const SUBJECTS: Record<string, Tint> = { Maths: "blue", English: "violet", Science: "green", History: "amber", Art: "rose", Music: "teal" };
const ROWS: string[][] = [
  ["Maths", "English", "Science", "Maths", "History"],
  ["English", "Maths", "History", "Science", "Maths"],
  ["Science", "Art", "Maths", "English", "Music"],
  ["History", "Science", "English", "Art", "English"],
];

export function ProductPreview({ className }: { className?: string }) {
  return (
    <figure className={cn("relative", className)}>
      <div aria-hidden className="overflow-hidden rounded-2xl border bg-surface shadow-overlay">
        {/* Window bar */}
        <div className="flex items-center gap-2 border-b bg-surface-subtle px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="ml-3 h-5 flex-1 rounded-md bg-muted" />
        </div>
        <div className="flex">
          {/* Mini sidebar */}
          <div className="hidden w-40 shrink-0 flex-col gap-1 border-r bg-surface p-3 sm:flex">
            <div className="mb-2 flex items-center gap-2">
              <LogoMark className="size-6" />
              <span className="h-2.5 w-16 rounded bg-foreground/80" />
            </div>
            {["w-20", "w-16", "w-24", "w-14", "w-20"].map((width, index) => (
              <div key={index} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5", index === 3 && "bg-primary-soft")}>
                <span className={cn("size-3 rounded", index === 3 ? "bg-primary" : "bg-border-strong")} />
                <span className={cn("h-2 rounded", width, index === 3 ? "bg-primary/60" : "bg-border-strong")} />
              </div>
            ))}
          </div>
          {/* Timetable */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold text-foreground">Grade 8 · Section A</p>
                <p className="text-[11px] text-muted-foreground">Weekly timetable</p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
                <Check className="size-3" /> Published
              </span>
            </div>
            <div className="grid grid-cols-[2rem_repeat(5,minmax(0,1fr))] gap-1.5 text-[11px]">
              <span />
              {DAYS.map((day) => (
                <span key={day} className="pb-0.5 text-center font-medium text-muted-foreground">
                  {day}
                </span>
              ))}
              {ROWS.map((row, period) => (
                <Row key={period} period={period + 1} subjects={row} />
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Floating cover card */}
      <div aria-hidden className="absolute -bottom-6 -left-3 hidden w-60 rounded-xl border bg-surface p-3.5 shadow-raised sm:block lg:-left-10">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <UserRoundCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-foreground">Cover assigned</p>
            <p className="truncate text-[11px] text-muted-foreground">Period 3 · Science · Grade 8 A</p>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">Illustration of a weekly class timetable in Timetable Maker, using sample data.</figcaption>
    </figure>
  );
}

function Row({ period, subjects }: { period: number; subjects: string[] }) {
  return (
    <>
      <span className="flex items-center justify-center font-medium text-muted-foreground tabular">{period}</span>
      {subjects.map((subject, index) => (
        <span key={index} className={cn("truncate rounded-md border px-1.5 py-2 text-center font-medium", TINT[SUBJECTS[subject] ?? "blue"])}>
          {subject}
        </span>
      ))}
    </>
  );
}
