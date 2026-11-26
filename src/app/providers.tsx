"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/zod-config";
import { makeQueryClient } from "@/lib/query/query-client";

/** Client providers. The app is light-only, so there is no theme provider (and no inline theme script). */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster position="bottom-right" closeButton richColors={false} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
