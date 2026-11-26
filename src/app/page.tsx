import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasSessionCookie, serverGet } from "@/lib/api/server";
import type { AcademicYear } from "@/lib/api/types";
import { pickDefaultYear, YEAR_PREFERENCE_COOKIE } from "@/features/academic-years/year-defaults";
import { LandingPage } from "@/features/landing/landing-page";

export const metadata: Metadata = {
  title: { absolute: "Timetable Maker · School timetables without the chaos" },
  description: "Plan classes, subjects and teachers, generate a conflict-checked timetable, publish it, and manage daily cover in one place.",
};

/**
 * "/" is public. Signed-in administrators go straight to their last-used academic year (or the ACTIVE / newest
 * DRAFT year, else first-run setup); everyone else sees the landing page. The session is checked
 * authoritatively with GET /api/admin/me: a stale cookie shows the landing page, not an error.
 */
export default async function Home() {
  const store = await cookies();
  if (await hasSessionCookie()) {
    let destination: string | null = null;
    try {
      await serverGet("/api/admin/me");
      const years = await serverGet<AcademicYear[]>("/api/academic-years");
      const year = pickDefaultYear(years, store.get(YEAR_PREFERENCE_COOKIE)?.value ?? null);
      destination = year ? `/years/${year.id}/dashboard` : "/setup/start";
    } catch {
      // Expired session (401) or the service is unreachable: the public page still renders.
    }
    if (destination) redirect(destination);
  }
  return <LandingPage />;
}
