import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/states";
import { DailyBoard } from "@/features/operations/components/daily-board";

export const metadata: Metadata = { title: "Daily cover" };

export default function DailyCoverPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DailyBoard />
    </Suspense>
  );
}
