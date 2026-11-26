"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Query flag the Setup guide adds to its step links so the destination page can offer a way back. */
export const FROM_SETUP_PARAM = "from";
export const FROM_SETUP_VALUE = "setup";

/** Appends the "came from the Setup guide" flag to a year-relative link. */
export function withSetupReturn(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}${FROM_SETUP_PARAM}=${FROM_SETUP_VALUE}`;
}

const YEAR_PATH = /^\/years\/([^/]+)\//;

/**
 * "Back to setup guide" link, shown only when the page was opened from a Setup guide step.
 * The year comes from the URL so this works without the year context.
 */
export function SetupReturnLink() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const yearId = pathname.match(YEAR_PATH)?.[1];
  if (!yearId || searchParams.get(FROM_SETUP_PARAM) !== FROM_SETUP_VALUE) return null;

  return (
    <Link
      href={`/years/${yearId}/setup`}
      className="-ml-1 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to setup guide
    </Link>
  );
}
