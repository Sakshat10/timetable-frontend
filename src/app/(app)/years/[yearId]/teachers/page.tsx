import type { Metadata } from "next";
import { TeachersPage } from "@/features/teachers/teachers-page";

export const metadata: Metadata = { title: "Teachers" };

export default function Page() {
  return <TeachersPage />;
}
