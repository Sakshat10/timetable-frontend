import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverGet } from "@/lib/api/server";
import type { AcademicYear } from "@/lib/api/types";
import { pickDefaultYear, YEAR_PREFERENCE_COOKIE } from "@/features/academic-years/year-defaults";

/** "/" opens the last-used academic year (or the ACTIVE / newest DRAFT year), else the first-run setup. */
export default async function Home() {
  const years = await serverGet<AcademicYear[]>("/api/academic-years");
  const preferred = (await cookies()).get(YEAR_PREFERENCE_COOKIE)?.value ?? null;
  const year = pickDefaultYear(years, preferred);
  redirect(year ? `/years/${year.id}/dashboard` : "/setup/start");
}
