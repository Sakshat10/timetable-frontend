"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { yearsApi } from "@/lib/api/endpoints";
import { qk } from "@/lib/query/keys";
import { useRememberedYearId } from "@/components/layout/use-remembered-year";
import { pickDefaultYear, useOptionalYear } from "./year-context";
import { YearStatusBadge } from "./year-status-badge";

/**
 * Switches the academic year while keeping the current sub-page (/years/A/classes -> /years/B/classes).
 */
export function YearSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const context = useOptionalYear();
  const remembered = useRememberedYearId();
  const { data: years, isPending, isError } = useQuery({ queryKey: qk.years(), queryFn: yearsApi.list });

  if (isPending) return <Skeleton className="h-9 w-full" />;
  if (isError || !years) return null;

  if (years.length === 0) {
    return (
      <Button asChild variant="outline" size="sm" className="w-full justify-start">
        <Link href="/setup/start">Create an academic year</Link>
      </Button>
    );
  }

  const current = context?.year ?? pickDefaultYear(years, remembered);
  const sorted = [...years].sort((a, b) => (a.startDate < b.startDate ? 1 : -1));

  function switchTo(yearId: string) {
    const match = /^\/years\/[^/]+(\/.*)?$/.exec(pathname);
    const rest = match?.[1] ?? "/dashboard";
    // Detail pages (a specific timetable or teacher) belong to the old year: go to their list instead.
    const listOnly = rest.replace(/^(\/timetables)\/.+$/, "$1");
    router.push(`/years/${yearId}${listOnly}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto w-full justify-between px-2.5 py-1.5">
          <span className="flex min-w-0 flex-col items-start">
            <span className="text-[11px] font-normal text-muted-foreground">Academic year</span>
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{current?.name ?? "Select a year"}</span>
              {current ? <YearStatusBadge status={current.status} compact /> : null}
            </span>
          </span>
          {/* The accessible name is the visible text plus this suffix, so voice control matches what is shown. */}
          <span className="sr-only">, change academic year</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Academic years</DropdownMenuLabel>
        {sorted.map((year) => (
          <DropdownMenuItem key={year.id} onSelect={() => switchTo(year.id)} className="justify-between">
            <span className="flex items-center gap-2">
              {year.id === current?.id ? <Check className="size-4" aria-hidden /> : <span className="size-4" aria-hidden />}
              {year.name}
            </span>
            <YearStatusBadge status={year.status} compact />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings#academic-years">
            <Settings2 className="size-4" aria-hidden /> Manage academic years
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
