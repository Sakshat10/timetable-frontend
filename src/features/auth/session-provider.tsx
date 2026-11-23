"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { onUnauthorized, resetUnauthorizedSignal } from "@/lib/api/client";
import type { Admin, School } from "@/lib/api/types";

interface Session {
  admin: Admin;
  school: School;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Holds the signed-in admin and school (loaded by the server auth gate) and handles session loss:
 * any 401 from the API clears every cached query and redirects to /login exactly once, with one notice
 * (AUTH-PROXY-TEST-PLAN T4.2/T4.6).
 */
export function SessionProvider({ admin, school, children }: Session & { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    resetUnauthorizedSignal();
  }, []);

  useEffect(() => {
    return onUnauthorized(() => {
      queryClient.cancelQueries();
      queryClient.clear();
      toast.warning("Your session ended", { id: "session-ended", description: "Please sign in again to continue." });
      const next = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname;
      router.replace(`/login?reason=expired&next=${encodeURIComponent(next)}`);
    });
  }, [queryClient, router, pathname]);

  return <SessionContext value={{ admin, school }}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside the signed-in application layout");
  return session;
}
