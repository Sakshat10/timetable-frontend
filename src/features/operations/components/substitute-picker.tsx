"use client";

import { useId, useRef, useState } from "react";
import { ChevronDown, Info, Star, UserX } from "lucide-react";
import { ConfirmDialog, PendingButton } from "@/components/shared/confirm-dialog";
import { FormAlert } from "@/components/shared/form-fields";
import { EmptyState, ErrorState, StaleDataNotice } from "@/components/shared/states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import type { Candidate, Cover } from "@/lib/api/schemas";
import { formatDateLong } from "@/lib/dates";
import { notifyError, notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  assignOutcome,
  candidateActionLabel,
  candidateRole,
  consecutiveText,
  groupCandidates,
  groupExcluded,
  needsLastResortConfirmation,
  periodsText,
  POLICY_LABEL,
  TIER_TITLE,
} from "../candidate-rules";
import { useAssignCover, useCandidates } from "../hooks";

interface PendingConfirmation {
  candidate: Candidate;
  periods: number[];
  /** Set when the server asked for the confirmation (FOUR_CONSECUTIVE_CONFIRMATION_REQUIRED). */
  serverMessage?: string;
}

/**
 * The substitute picker for one cover (PHASE-0-AUDIT §6.3). Candidates, tiers, ranking and explanations all
 * come from GET /substitutions/:id/candidates. Per-candidate figures appear only here (CAPABILITY-BOUNDARIES P2).
 */
export function SubstitutePicker({ cover }: { cover: Cover }) {
  const candidates = useCandidates(cover.id, cover.status === "OPEN" || cover.status === "ASSIGNED");
  const assign = useAssignCover();
  const inFlight = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const headingId = useId();

  function success(name: string) {
    notifySuccess(`${name} is covering period ${cover.periodNumber}`, `${cover.section.name} · ${cover.subject.name} on ${formatDateLong(cover.date)}`);
  }

  async function assignDirectly(candidate: Candidate) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingId(candidate.id);
    setNotice(null);
    try {
      await assign.mutateAsync({ id: cover.id, body: { teacherId: candidate.id } });
      success(candidate.name);
    } catch (error) {
      const outcome = assignOutcome(error);
      switch (outcome.kind) {
        case "confirm":
          setConfirmation({ candidate, periods: outcome.periods.length > 0 ? outcome.periods : candidate.consecutive.periods, serverMessage: outcome.message });
          break;
        case "refresh-candidates":
          setNotice(`${outcome.message} The list of teachers has been refreshed.`);
          break;
        case "refresh-board":
          setNotice(`${outcome.message} The daily cover board has been refreshed.`);
          break;
        case "uncertain":
          notifyError(error, "Couldn’t confirm the assignment");
          break;
        default:
          setNotice(outcome.message);
      }
    } finally {
      inFlight.current = false;
      setPendingId(null);
    }
  }

  function choose(candidate: Candidate) {
    if (needsLastResortConfirmation(candidate)) setConfirmation({ candidate, periods: candidate.consecutive.periods });
    else void assignDirectly(candidate);
  }

  async function confirmLastResort() {
    if (!confirmation) return;
    const { candidate } = confirmation;
    await assign.mutateAsync({ id: cover.id, body: { teacherId: candidate.id, confirmFourConsecutive: true } });
    success(candidate.name);
  }

  const data = candidates.data;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="space-y-1">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {cover.status === "ASSIGNED" ? "Choose a different substitute" : "Choose a substitute"}
        </h3>
        <p className="text-xs text-muted-foreground">
          The teachers, their order and the recommendation come from the server. Temporary (unqualified) cover applies to this one lesson only: it never
          changes who is eligible to teach a subject, and never changes the published timetable.
        </p>
      </div>

      {candidates.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading teachers who can cover">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : candidates.isError && !data ? (
        <ErrorState compact error={candidates.error} title="Couldn’t load the teachers who can cover" onRetry={() => void candidates.refetch()} />
      ) : data ? (
        <>
          {candidates.isRefetchError ? <StaleDataNotice onRetry={() => void candidates.refetch()} /> : null}
          <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              <span className="font-medium text-foreground">School setting:</span> {POLICY_LABEL[data.policy]}.
              {data.selection.summary ? ` ${data.selection.summary}` : ""}
            </p>
          </div>
          {notice ? <FormAlert>{notice}</FormAlert> : null}
          <CandidateGroupsView
            data={data.candidates}
            cover={cover}
            pendingId={pendingId}
            disabled={pendingId !== null}
            onChoose={choose}
            emptyMessage={data.message}
          />
          <ExcludedList excluded={data.excluded} />
        </>
      ) : null}

      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => (!open ? setConfirmation(null) : undefined)}
        title={confirmation ? `Assign ${confirmation.candidate.name} as a last resort?` : "Assign as a last resort?"}
        description={
          confirmation ? (
            <>
              {confirmation.candidate.name} would teach {confirmation.periods.length > 0 ? `${confirmation.periods.length} consecutive periods (${periodsText(confirmation.periods)})` : "four or more consecutive periods"} on{" "}
              {formatDateLong(cover.date)}.
            </>
          ) : null
        }
        confirmLabel="Assign as last resort"
        onConfirm={confirmLastResort}
      >
        {confirmation?.serverMessage ? <p className="text-muted-foreground">{confirmation.serverMessage}</p> : null}
        <p className="text-muted-foreground">
          Four or more consecutive periods are avoided while another teacher is free. Confirm only if no better option works for this lesson.
        </p>
      </ConfirmDialog>
    </section>
  );
}

function CandidateGroupsView({
  data,
  cover,
  pendingId,
  disabled,
  onChoose,
  emptyMessage,
}: {
  data: Candidate[];
  cover: Cover;
  pendingId: string | null;
  disabled: boolean;
  onChoose: (candidate: Candidate) => void;
  emptyMessage?: string;
}) {
  const groups = groupCandidates(data);
  const shown = groups.sameSubject.length + groups.otherAvailable.length + groups.lastResort.length;
  const list = (items: Candidate[]) => (
    <ul className="space-y-2">
      {items.map((candidate) => (
        <CandidateCard key={candidate.id} candidate={candidate} cover={cover} pending={pendingId === candidate.id} disabled={disabled} onChoose={onChoose} />
      ))}
    </ul>
  );
  return (
    <div className="space-y-4">
      {shown === 0 && groups.notOffered.length === 0 ? (
        <EmptyState compact icon={<UserX className="size-5" />} title="No teacher can cover this lesson" description={emptyMessage ?? "Every teacher is busy, absent or unavailable in this period."} />
      ) : null}
      {groups.sameSubject.length > 0 ? (
        <TierGroup title={TIER_TITLE.SAME_SUBJECT} count={groups.sameSubject.length} description="Teachers of this subject.">
          {list(groups.sameSubject)}
        </TierGroup>
      ) : null}
      {groups.otherAvailable.length > 0 ? (
        <TierGroup
          title={TIER_TITLE.OTHER_AVAILABLE}
          count={groups.otherAvailable.length}
          description="Free teachers who don’t teach this subject. They would give temporary (unqualified) cover for this lesson only."
        >
          {list(groups.otherAvailable)}
        </TierGroup>
      ) : null}
      {groups.lastResort.length > 0 ? (
        <TierGroup
          title={TIER_TITLE.LAST_RESORT}
          count={groups.lastResort.length}
          description="Each of these teachers would teach four or more periods in a row. You’ll be asked to confirm."
        >
          {list(groups.lastResort)}
        </TierGroup>
      ) : null}
      {groups.notOffered.length > 0 ? (
        <Collapsible className="rounded-lg border">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <span>
              Not offered while better options exist <span className="tabular text-muted-foreground">({groups.notOffered.length})</span>
            </span>
            <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 border-t px-3 py-3">
            <p className="text-xs text-muted-foreground">
              These teachers would teach four or more periods in a row, so they are held back while another teacher is free. You can still choose one after
              confirming.
            </p>
            {list(groups.notOffered)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function TierGroup({ title, count, description, children }: { title: string; count: number; description: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h4 id={id} className="text-sm font-semibold text-foreground">
          {title} <span className="tabular font-normal text-muted-foreground">({count})</span>
        </h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function CandidateCard({
  candidate,
  cover,
  pending,
  disabled,
  onChoose,
}: {
  candidate: Candidate;
  cover: Cover;
  pending: boolean;
  disabled: boolean;
  onChoose: (candidate: Candidate) => void;
}) {
  const role = candidateRole(candidate, cover);
  const label = candidateActionLabel(candidate, role);
  const lastResort = needsLastResortConfirmation(candidate);
  return (
    <li className={cn("rounded-lg border bg-surface p-3", candidate.recommended && "border-primary/40")} aria-label={candidate.name}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-medium text-foreground">
            {candidate.name}
            {candidate.employeeCode ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{candidate.employeeCode}</span> : null}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {candidate.recommended ? (
              <StatusBadge tone="accent" icon={<Star className="size-3" aria-hidden />}>
                Recommended
              </StatusBadge>
            ) : null}
            {role === "current" || role === "confirm-automatic" ? <StatusBadge tone="success">Current substitute</StatusBadge> : null}
            {candidate.temporaryUnqualified ? (
              <StatusBadge tone="info" dot={false}>
                Temporary (unqualified)
              </StatusBadge>
            ) : null}
            {lastResort ? <StatusBadge tone="warning">4+ consecutive periods</StatusBadge> : null}
          </div>
        </div>
        {label ? (
          <PendingButton
            size="sm"
            variant={role === "replace" || role === "assign" ? (lastResort ? "outline" : "default") : "outline"}
            className="w-full sm:w-auto"
            pending={pending}
            disabled={disabled}
            onClick={() => onChoose(candidate)}
          >
            {label}
          </PendingButton>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{candidate.explanation}</p>
      {role === "confirm-automatic" ? (
        <p className="mt-1 text-xs text-muted-foreground">Assigned automatically. Keeping them makes it a manual choice that later automatic runs won’t change.</p>
      ) : null}
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-2.5 text-xs sm:grid-cols-4">
        <Fact label="Periods this week" value={candidate.weeklyLoad} />
        <Fact label="Covers today" value={candidate.coverLoadToday} />
        <Fact label="Covers (last 28 days)" value={candidate.recentCovers} />
        <Fact label="Consecutive" value={consecutiveText(candidate.consecutive)} />
      </dl>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ExcludedList({ excluded }: { excluded: Parameters<typeof groupExcluded>[0] }) {
  const groups = groupExcluded(excluded);
  const total = groups.reduce((sum, g) => sum + g.names.length, 0);
  if (total === 0) return null;
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <span>
          Teachers who can’t cover this lesson <span className="tabular text-muted-foreground">({total})</span>
        </span>
        <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-3">
        <dl className="space-y-2 text-sm">
          {groups.map((group) => (
            <div key={group.reason}>
              <dt className="text-xs font-medium text-muted-foreground">
                {group.label} <span className="tabular">({group.names.length})</span>
              </dt>
              <dd className="text-foreground">{group.names.join(", ")}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
