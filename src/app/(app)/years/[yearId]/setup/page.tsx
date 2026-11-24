import type { Metadata } from "next";
import { SetupGuidePage } from "@/features/setup-guide/setup-guide-page";

export const metadata: Metadata = { title: "Setup guide" };

export default function Page() {
  return <SetupGuidePage />;
}
