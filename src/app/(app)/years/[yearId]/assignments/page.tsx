import type { Metadata } from "next";
import { AssignmentsPage } from "@/features/assignments/assignments-page";

export const metadata: Metadata = { title: "Assignments" };

export default function Page() {
  return <AssignmentsPage />;
}
