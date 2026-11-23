import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isApiError } from "@/lib/api/errors";
import { serverGet } from "@/lib/api/server";
import type { Admin, School } from "@/lib/api/types";
import { SessionProvider } from "@/features/auth/session-provider";
import { AppShell } from "@/components/layout/app-shell";
import { ErrorState } from "@/components/shared/states";

/**
 * Authoritative auth gate (FRONTEND-ARCHITECTURE.md §2.2): every signed-in page renders only after
 * GET /api/admin/me succeeds with the forwarded session cookie. A 401 redirects to /login.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let admin: Admin;
  let school: School;
  try {
    admin = await serverGet<Admin>("/api/admin/me");
    school = await serverGet<School>(`/api/schools/${encodeURIComponent(admin.schoolId)}`);
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      const path = (await headers()).get("x-pathname") ?? "";
      redirect(path && path !== "/" ? `/login?next=${encodeURIComponent(path)}` : "/login");
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <ErrorState
          title="Can’t reach the timetable service"
          message={isApiError(error) ? error.message : "The timetable service did not respond. Please try again in a moment."}
          className="w-full max-w-lg"
        />
      </main>
    );
  }

  return (
    <SessionProvider admin={admin} school={school}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
