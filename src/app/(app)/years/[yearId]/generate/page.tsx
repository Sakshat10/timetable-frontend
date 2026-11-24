import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/states";
import { GeneratePage } from "@/features/generation/generate-page";

export const metadata: Metadata = { title: "Generate timetable" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GeneratePage />
    </Suspense>
  );
}
