"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CurriculumOverview } from "@/lib/api/schemas";

/**
 * Weekly periods required per grade/stream (curriculum totalPeriods) against the schedule's weekly
 * teaching capacity (weeklySlots). Real backend data only; groups above the line cannot fit.
 */
export function CurriculumLoadChart({ curriculum }: { curriculum: CurriculumOverview }) {
  const rows = curriculum.grades.flatMap((grade) =>
    grade.curricula.map((group) => ({ name: group.label, periods: group.totalPeriods })),
  );
  if (rows.length === 0) return null;
  const slots = curriculum.weeklySlots;
  const max = Math.max(slots ?? 0, ...rows.map((r) => r.periods));
  const over = slots ? rows.filter((r) => r.periods > slots) : [];
  const summary = slots
    ? `${rows.length} grade groups. Weekly capacity is ${slots} periods. ${over.length ? `${over.length} above capacity: ${over.map((o) => o.name).join(", ")}.` : "All fit within capacity."}`
    : `${rows.length} grade groups. No schedule yet, so capacity is unknown.`;

  return (
    <figure className="space-y-2">
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} interval={0} tick={{ fill: "var(--muted-foreground)" }} />
            <YAxis allowDecimals={false} domain={[0, Math.ceil(max * 1.1)]} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: "var(--muted-foreground)" }} />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              formatter={(value) => [`${value} periods / week`, "Required"]}
            />
            {slots ? <ReferenceLine y={slots} stroke="var(--warning)" strokeDasharray="4 4" label={{ value: `Capacity ${slots}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} /> : null}
            <Bar dataKey="periods" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-xs text-muted-foreground">{summary}</figcaption>
    </figure>
  );
}
