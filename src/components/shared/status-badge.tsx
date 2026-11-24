import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  info: "bg-info-muted text-info border-info/20",
  success: "bg-success-muted text-success border-success/20",
  warning: "bg-warning-muted text-warning-foreground border-warning/30",
  danger: "bg-destructive-muted text-destructive border-destructive/20",
  accent: "bg-accent text-accent-foreground border-primary/20",
};

const dotClass: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  accent: "bg-primary",
};

/**
 * A status label. Always carries text (status is never conveyed by colour alone);
 * the dot is decorative.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
  dot = true,
  icon,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {icon ? icon : dot ? <span aria-hidden className={cn("size-1.5 rounded-full", dotClass[tone])} /> : null}
      {children}
    </span>
  );
}
