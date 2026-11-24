import type { Metadata } from "next";
import { ClassesPage } from "@/features/classes/classes-page";

export const metadata: Metadata = { title: "Classes" };

export default function Page() {
  return <ClassesPage />;
}
