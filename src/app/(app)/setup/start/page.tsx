import type { Metadata } from "next";
import { SetupStartPage } from "@/features/setup-guide/start-page";

export const metadata: Metadata = { title: "Get started" };

export default function Page() {
  return <SetupStartPage />;
}
