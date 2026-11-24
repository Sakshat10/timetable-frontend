import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import type { Cover } from "@/lib/api/schemas";
import { attentionText, COVER_STATUS_LABEL, SOURCE_LABEL } from "../board-rules";

const STATUS_TONE: Record<Cover["status"], Tone> = { OPEN: "warning", ASSIGNED: "success", CANCELLED: "neutral", OBSOLETE: "neutral" };

export function CoverStatusBadge({ status }: { status: Cover["status"] }) {
  return <StatusBadge tone={STATUS_TONE[status]}>{COVER_STATUS_LABEL[status]}</StatusBadge>;
}

export function SourceBadge({ source }: { source: Cover["assignmentSource"] }) {
  if (!source) return null;
  return (
    <StatusBadge tone="neutral" dot={false}>
      {SOURCE_LABEL[source]}
    </StatusBadge>
  );
}

export function TemporaryCoverBadge() {
  return (
    <StatusBadge tone="info" dot={false}>
      Temporary (unqualified) cover
    </StatusBadge>
  );
}

/** The backend's attention message for a cover (always text, with an icon). */
export function AttentionNote({ attention, className }: { attention: Cover["attention"]; className?: string }) {
  const text = attentionText(attention);
  if (!text) return null;
  return (
    <p className={className ?? "flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning"}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">Needs attention: </span>
        {text}
      </span>
    </p>
  );
}

/** A refusal message plus the lessons the backend listed in `errors.lessons`. */
export function RefusalWithLessons({ message, lessons, footer }: { message: string; lessons: string[]; footer?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p>{message}</p>
      {lessons.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5">
          {lessons.map((lesson) => (
            <li key={lesson}>{lesson}</li>
          ))}
        </ul>
      ) : null}
      {footer}
    </div>
  );
}
