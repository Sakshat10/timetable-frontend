"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSession } from "@/features/auth/session-provider";
import { useOptionalYear } from "@/features/academic-years/year-context";
import { authApi } from "@/lib/api/endpoints";
import { useBreadcrumbOverrides } from "./breadcrumbs";
import { SEGMENT_LABEL } from "./nav";
import { SubstitutionUpdatesBell } from "./substitution-updates-slot";

function useCrumbs() {
  const pathname = usePathname();
  const year = useOptionalYear();
  const overrides = useBreadcrumbOverrides();
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; href: string }> = [];
  let href = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    href += `/${part}`;
    if (part === "years") continue;
    if (year && part === year.year.id) {
      crumbs.push({ label: year.year.name, href: `${href}/dashboard` });
      continue;
    }
    const label = overrides[href] ?? SEGMENT_LABEL[part];
    if (label) crumbs.push({ label, href });
  }
  return crumbs;
}

export function AppHeader() {
  const crumbs = useCrumbs();
  const { admin, school } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    try {
      await authApi.logout();
    } catch {
      // The cookie is cleared server-side when the request arrives; if it did not, the next request returns 401.
      toast.error("Couldn’t confirm sign-out with the server", { description: "You have been signed out on this device." });
    }
    queryClient.clear();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:h-16 sm:px-5">
      <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mr-1.5 data-[orientation=vertical]:h-5" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.href}>
              {index > 0 ? <BreadcrumbSeparator className="hidden sm:block" /> : null}
              <BreadcrumbItem className={index < crumbs.length - 1 ? "hidden sm:inline-flex" : "min-w-0"}>
                {index === crumbs.length - 1 ? (
                  <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-1">
        <SubstitutionUpdatesBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 rounded-full px-1 sm:pr-2.5">
              {/* Accessible name: "Account menu" plus the visible name when it is shown (label-in-name). */}
              <span className="sr-only">Account menu, </span>
              <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-accent-foreground" aria-hidden>
                {initials(admin.name)}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-medium text-foreground lg:inline">
                {admin.name}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-accent-foreground" aria-hidden>
                {initials(admin.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{admin.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{admin.email}</span>
                <span className="block truncate text-xs text-muted-foreground">{school.name}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="size-4" aria-hidden /> School settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut className="size-4" aria-hidden /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
