"use client";

import { ErrorState } from "@/components/shared/states";

/** Route-level error boundary. Generic text only: never renders the error's message or stack. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-6">
      <ErrorState title="This page ran into a problem" message="Something went wrong while showing this page. Try again, or go back to the dashboard." onRetry={reset} />
    </div>
  );
}
