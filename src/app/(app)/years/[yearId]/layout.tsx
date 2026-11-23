import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isApiError } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";
import type { AcademicYear } from "@/lib/api/types";
import { YearProvider } from "@/features/academic-years/year-context";
import { ErrorState } from "@/components/shared/states";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function YearLayout({ children, params }: { children: ReactNode; params: Promise<{ yearId: string }> }) {
  const { yearId } = await params;
  if (!UUID.test(yearId)) notFound();
  let year: AcademicYear;
  try {
    year = await serverGet<AcademicYear>(`/api/academic-years/${yearId}`);
  } catch (error) {
    if (isApiError(error) && error.isNotFound) notFound();
    return (
      <div className="p-6">
        <ErrorState title="Couldn’t load this academic year" message={isApiError(error) ? error.message : undefined} />
      </div>
    );
  }
  return <YearProvider initialYear={year}>{children}</YearProvider>;
}
