import type { Metadata } from "next";
import { CurriculumPage } from "@/features/curriculum/curriculum-page";

export const metadata: Metadata = { title: "Curriculum" };

export default function Page() {
  return <CurriculumPage />;
}
