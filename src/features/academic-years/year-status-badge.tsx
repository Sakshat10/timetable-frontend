import { StatusBadge, type Tone } from "@/components/shared/status-badge";
import type { AcademicYearStatus, VersionStatus } from "@/lib/api/types";
import { VERSION_STATUS_LABEL, YEAR_STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const yearTone: Record<AcademicYearStatus, Tone> = { DRAFT: "info", ACTIVE: "success", COMPLETED: "neutral" };
const versionTone: Record<VersionStatus, Tone> = { DRAFT: "info", PUBLISHED: "success", ARCHIVED: "neutral" };

export function YearStatusBadge({ status, compact, className }: { status: AcademicYearStatus; compact?: boolean; className?: string }) {
  return (
    <StatusBadge tone={yearTone[status]} className={cn(compact && "h-5 px-1.5 text-[11px]", className)}>
      {YEAR_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

export function VersionStatusBadge({ status, className }: { status: VersionStatus; className?: string }) {
  return (
    <StatusBadge tone={versionTone[status]} className={className}>
      {VERSION_STATUS_LABEL[status]}
    </StatusBadge>
  );
}
