import type { Metadata } from "next";
import { AbsenceDetailPage } from "@/features/operations/components/absence-detail-page";

export const metadata: Metadata = { title: "Absence" };

export default async function Page({ params }: PageProps<"/operations/absences/[absenceId]">) {
  const { absenceId } = await params;
  return <AbsenceDetailPage absenceId={absenceId} />;
}
