"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSession } from "@/features/auth/session-provider";
import { useOptionalYear } from "@/features/academic-years/year-context";
import { pickDefaultYear } from "@/features/academic-years/year-defaults";
import { yearsApi } from "@/lib/api/endpoints";
import { qk } from "@/lib/query/keys";
import { YearSwitcher } from "@/features/academic-years/year-switcher";
import { NAV, resolveHref } from "./nav";
import { useRememberedYearId } from "./use-remembered-year";

export function AppSidebar() {
  const pathname = usePathname();
  const { school } = useSession();
  const yearContext = useOptionalYear();
  const rememberedYearId = useRememberedYearId();
  // Outside a year (operations, settings) the year-scoped links use the remembered year, else the default year.
  const years = useQuery({ queryKey: qk.years(), queryFn: yearsApi.list, enabled: !yearContext });
  const yearId = yearContext?.year.id ?? pickDefaultYear(years.data ?? [], rememberedYearId)?.id ?? null;
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-3">
        <Link href="/" className="flex items-center gap-2.5 rounded-md px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden>
            <CalendarDays className="size-4" />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold text-sidebar-foreground">{school.name}</span>
            <span className="block truncate text-xs text-muted-foreground">Timetable Maker</span>
          </span>
        </Link>
        <div className="group-data-[collapsible=icon]:hidden">
          <YearSwitcher />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const href = resolveHref(item, yearId);
                if (!href) return null;
                const active =
                  pathname === href ||
                  (item.href !== "/operations" && pathname.startsWith(`${href}/`)) ||
                  (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={href} onClick={() => setOpenMobile(false)} aria-current={active ? "page" : undefined}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
