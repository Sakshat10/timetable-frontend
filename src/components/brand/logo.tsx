import { cn } from "@/lib/utils";

/**
 * The Timetable Maker mark: a rounded blue tile with a simple timetable grid (one highlighted cell).
 * Decorative by default; pass `title` when the mark stands alone as a link's only content.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <rect x="7" y="8" width="18" height="3" rx="1.5" fill="white" opacity="0.95" />
      <rect x="7" y="13.5" width="5" height="4" rx="1.25" fill="white" opacity="0.55" />
      <rect x="13.5" y="13.5" width="5" height="4" rx="1.25" fill="white" />
      <rect x="20" y="13.5" width="5" height="4" rx="1.25" fill="white" opacity="0.55" />
      <rect x="7" y="19.5" width="5" height="4" rx="1.25" fill="white" opacity="0.55" />
      <rect x="13.5" y="19.5" width="5" height="4" rx="1.25" fill="white" opacity="0.55" />
      <rect x="20" y="19.5" width="5" height="4" rx="1.25" fill="white" opacity="0.55" />
    </svg>
  );
}

/** Mark plus wordmark. */
export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">Timetable Maker</span>
    </span>
  );
}
