import {
  BookOpen,
  CalendarCheck2,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Settings,
  Sparkles,
  UserMinus,
  UserRoundCheck,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  /** Year-scoped items are relative to /years/[yearId]; others are absolute. */
  href: string;
  yearScoped: boolean;
  icon: LucideIcon;
  /** Extra path prefixes that mark this item as active. */
  match?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The complete navigation. Every entry is a real, implemented page backed by existing endpoints.
 * Nothing here may refer to a capability in CAPABILITY-BOUNDARIES.md §1 (no exports, workload,
 * activity/audit logs, time zones, password reset).
 */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", yearScoped: true, icon: LayoutDashboard },
      { label: "Setup guide", href: "/setup", yearScoped: true, icon: ListChecks },
    ],
  },
  {
    label: "School setup",
    items: [
      { label: "Classes", href: "/classes", yearScoped: true, icon: GraduationCap },
      { label: "Subjects", href: "/subjects", yearScoped: true, icon: BookOpen },
      { label: "Curriculum", href: "/curriculum", yearScoped: true, icon: ClipboardList },
      { label: "Teachers", href: "/teachers", yearScoped: true, icon: Users },
      { label: "Assignments", href: "/assignments", yearScoped: true, icon: UserRoundCheck },
      { label: "Schedule", href: "/schedule", yearScoped: true, icon: CalendarClock },
    ],
  },
  {
    label: "Timetable",
    items: [
      { label: "Generate", href: "/generate", yearScoped: true, icon: Sparkles },
      { label: "Timetables", href: "/timetables", yearScoped: true, icon: CalendarRange },
    ],
  },
  {
    label: "Daily operations",
    items: [
      { label: "Daily cover", href: "/operations", yearScoped: false, icon: CalendarCheck2, match: ["/operations/covers"] },
      { label: "Absences", href: "/operations/absences", yearScoped: false, icon: UserMinus },
      { label: "Unavailability", href: "/operations/unavailability", yearScoped: false, icon: Workflow },
    ],
  },
  {
    label: "School",
    items: [{ label: "Settings", href: "/settings", yearScoped: false, icon: Settings }],
  },
];

export function resolveHref(item: NavItem, yearId: string | null): string | null {
  if (!item.yearScoped) return item.href;
  return yearId ? `/years/${yearId}${item.href}` : null;
}

/** Human labels for breadcrumb segments. */
export const SEGMENT_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  setup: "Setup guide",
  classes: "Classes",
  subjects: "Subjects",
  curriculum: "Curriculum",
  teachers: "Teachers",
  assignments: "Assignments",
  schedule: "Schedule",
  generate: "Generate",
  timetables: "Timetables",
  operations: "Daily cover",
  absences: "Absences",
  unavailability: "Unavailability",
  settings: "Settings",
  covers: "Cover",
};
