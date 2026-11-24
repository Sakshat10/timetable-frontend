import type { Metadata } from "next";
import { VersionsPage } from "@/features/timetables/versions-page";

export const metadata: Metadata = { title: "Timetables" };

export default function Page() {
  return <VersionsPage />;
}
