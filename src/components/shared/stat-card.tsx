import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A compact metric. Only ever shows numbers the backend returned (no invented metrics). */
export function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon ? <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</span> : null}
      </div>
      <div
        className={cn(
          "tabular text-2xl font-semibold tracking-tight",
          tone === "warning" && "text-warning-foreground dark:text-warning",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
        )}
      >
        {value}
      </div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      {href ? <ArrowUpRight className="absolute right-3 bottom-3 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /> : null}
    </>
  );
  const classes = cn("group relative flex flex-col gap-1.5 rounded-lg border bg-surface p-4", href && "transition-colors hover:border-primary/40 hover:bg-accent/40", className);
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** A bordered panel used for grouped content. */
export function Panel({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn("rounded-lg border bg-surface", padded && "p-4 sm:p-5", className)}>{children}</div>;
}

/** Form section: a heading and description on the left, fields on the right (stacks on mobile). */
export function FormSection({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-4 border-b py-6 first:pt-0 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,16rem)_1fr] md:gap-8", className)}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}

/** A label/value list. */
export function DetailList({ items, className }: { items: Array<{ label: string; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label} className="space-y-0.5">
          <dt className="text-xs font-medium text-muted-foreground">{item.label}</dt>
          <dd className="text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
