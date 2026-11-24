"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
import { LogoMark } from "@/components/brand/logo";
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
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="gap-4 px-3 pt-4 pb-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:px-0"
        >
          <LogoMark />
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-sm font-semibold tracking-tight text-foreground">Timetable Maker</span>
            <span className="block truncate text-xs text-muted-foreground" title={school.name}>
              {school.name}
            </span>
          </span>
        </Link>
        <div className="group-data-[collapsible=icon]:hidden">
          <YearSwitcher />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 px-1 pb-4">
        {NAV.map((group) => (
          <SidebarGroup key={group.label} className="py-1.5">
            <SidebarGroupLabel className="h-7 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</SidebarGroupLabel>
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => {
                const href = resolveHref(item, yearId);
                if (!href) return null;
                const active =
                  pathname === href ||
                  (item.href !== "/operations" && pathname.startsWith(`${href}/`)) ||
                  (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="h-9 gap-2.5 rounded-lg px-2.5 font-medium text-sidebar-foreground/90 data-active:font-semibold data-active:text-sidebar-accent-foreground [&_svg]:text-muted-foreground data-active:[&_svg]:text-primary"
                    >
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
