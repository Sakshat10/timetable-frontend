"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { onUnauthorized, resetUnauthorizedSignal } from "@/lib/api/client";
import type { Admin, School } from "@/lib/api/types";

interface Session {
  admin: Admin;
  school: School;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Holds the signed-in admin and school (loaded by the server auth gate) and handles session loss:
 * any 401 from the API clears every cached query and redirects to /login exactly once; the login page shows one
 * "Your session ended" notice for ?reason=expired (AUTH-PROXY-TEST-PLAN T4.2/T4.6).
 */
export function SessionProvider({ admin, school, children }: Session & { children: ReactNode }) {
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    resetUnauthorizedSignal();
  }, []);

  useEffect(() => {
    return onUnauthorized(() => {
      queryClient.cancelQueries();
      queryClient.clear();
      const next = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname;
      // A full-page navigation, not router.replace(): a client navigation started at the same moment (a click on a
      // link) could supersede a client-side redirect, leaving the user on a page with an expired session while the
      // one-shot signal is already spent. A hard navigation cannot be superseded and resets all in-memory state.
      window.location.replace(`/login?reason=expired&next=${encodeURIComponent(next)}`);
    });
  }, [queryClient, pathname]);

  return <SessionContext value={{ admin, school }}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside the signed-in application layout");
  return session;
}
