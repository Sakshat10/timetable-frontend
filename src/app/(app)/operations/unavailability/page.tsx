import type { Metadata } from "next";
import { UnavailabilityPage } from "@/features/operations/components/unavailability-page";

export const metadata: Metadata = { title: "Unavailability" };

export default function Page() {
  return <UnavailabilityPage />;
}
