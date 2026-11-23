import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/errors";

/** Retry reads only, and only for transient failures (network, 5xx). 4xx answers are final. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (isApiError(error)) return error.status === 0 || error.status >= 500;
  return false;
}

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // Writes are never retried automatically (uncertain outcomes are reconciled by re-reading).
        retry: false,
      },
    },
  });
}
