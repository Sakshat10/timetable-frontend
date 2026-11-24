import type { Metadata } from "next";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/states";
import { AbsencesPage } from "@/features/operations/components/absences-page";

export const metadata: Metadata = { title: "Absences" };

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AbsencesPage />
    </Suspense>
  );
}
