import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TeacherDetailPage } from "@/features/teachers/teacher-detail-page";

export const metadata: Metadata = { title: "Teacher" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  if (!UUID.test(teacherId)) notFound();
  return <TeacherDetailPage key={teacherId} teacherId={teacherId} />;
}
