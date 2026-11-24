import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/shared/states";
import { VersionPage } from "@/features/timetables/version-page";

export const metadata: Metadata = { title: "Timetable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  if (!UUID.test(versionId)) notFound();
  return (
    <Suspense fallback={<PageSkeleton />}>
      <VersionPage key={versionId} versionId={versionId} />
    </Suspense>
  );
}
