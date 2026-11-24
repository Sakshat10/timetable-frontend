"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DataTable, type DataColumn } from "@/components/data-table/data-table";
import { DeleteRecordDialog, PendingButton } from "@/components/shared/confirm-dialog";
import { applyServerErrors, FormAlert, TextField } from "@/components/shared/form-fields";
import { PageBody, PageHeader, Section } from "@/components/shared/page-header";
import { DetailList, FormSection, Panel } from "@/components/shared/stat-card";
import { ErrorState, TableSkeleton } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/session-provider";
import { YearFormDialog } from "@/features/academic-years/year-form";
import { ActivateYearDialog, CompleteYearDialog } from "@/features/academic-years/year-status-actions";
import { YearStatusBadge } from "@/features/academic-years/year-status-badge";
import { authApi, substitutionSettingsApi, yearsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import type { AcademicYear, ConsecutivePeriodPolicy } from "@/lib/api/types";
import { formatDate, isoDatePart } from "@/lib/dates";
import { notifyError, notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";

const SCHOOL_TYPE: Record<string, string> = { PRIMARY: "Primary", SECONDARY: "Secondary", CUSTOM: "Other" };

export function SettingsPage() {
  return (
    <PageBody className="max-w-5xl">
      <PageHeader title="Settings" description="School details, academic years, administrators and the substitution policy." />
      <SchoolSection />
      <YearsSection />
      <AdminsSection />
      <PolicySection />
    </PageBody>
  );
}

function SchoolSection() {
  const { school, admin } = useSession();
  const [copied, setCopied] = useState(false);
  return (
    <Section title="School" id="school">
      <Panel>
        <DetailList
          items={[
            { label: "Name", value: school.name },
            { label: "Type", value: SCHOOL_TYPE[school.schoolType] ?? school.schoolType },
            { label: "Short code", value: <span className="font-mono">{school.code}</span> },
            { label: "Signed in as", value: `${admin.name} (${admin.email})` },
            {
              label: "School ID (needed to sign in)",
              value: (
                <span className="flex items-center gap-2">
                  <code className="truncate font-mono text-xs" data-testid="settings-school-id">
                    {school.id}
                  </code>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => void navigator.clipboard?.writeText(school.id).then(() => setCopied(true))}
                    aria-label="Copy School ID"
                  >
                    {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
                  </Button>
                </span>
              ),
            },
          ]}
        />
        <p className="mt-4 text-xs text-muted-foreground">School details are set when the school is created and can’t be edited here.</p>
      </Panel>
    </Section>
  );
}

function YearsSection() {
  const queryClient = useQueryClient();
  const years = useQuery({ queryKey: qk.years(), queryFn: yearsApi.list });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AcademicYear | null>(null);
  const [activating, setActivating] = useState<AcademicYear | null>(null);
  const [completing, setCompleting] = useState<AcademicYear | null>(null);
  const [deleting, setDeleting] = useState<AcademicYear | null>(null);
  const activeYear = years.data?.find((y) => y.status === "ACTIVE");

  const columns: DataColumn<AcademicYear>[] = [
    {
      id: "name",
      header: "Name",
      sortValue: (y) => y.name,
      cell: (y) => (
        <Link href={`/years/${y.id}/dashboard`} className="font-medium hover:underline">
          {y.name}
        </Link>
      ),
    },
    { id: "start", header: "Starts", sortValue: (y) => y.startDate, cell: (y) => formatDate(isoDatePart(y.startDate)), hideOnMobile: true },
    { id: "end", header: "Ends", sortValue: (y) => y.endDate, cell: (y) => formatDate(isoDatePart(y.endDate)), hideOnMobile: true },
    { id: "status", header: "Status", sortValue: (y) => y.status, cell: (y) => <YearStatusBadge status={y.status} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (y) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${y.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={y.status === "COMPLETED"} onSelect={() => setEditing(y)}>
              Edit name and dates
            </DropdownMenuItem>
            {y.status === "DRAFT" ? (
              <DropdownMenuItem disabled={Boolean(activeYear)} onSelect={() => setActivating(y)}>
                {activeYear ? `Activate (complete ${activeYear.name} first)` : "Activate…"}
              </DropdownMenuItem>
            ) : null}
            {y.status === "ACTIVE" ? <DropdownMenuItem onSelect={() => setCompleting(y)}>Mark as completed…</DropdownMenuItem> : null}
            {y.status === "DRAFT" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(y)}>
                  Delete…
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <Section
      id="academic-years"
      title="Academic years"
      description="Years move one way: Draft → Active → Completed. Only draft years can be set up and generated."
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New academic year
        </Button>
      }
    >
      {years.isPending ? (
        <TableSkeleton rows={3} columns={4} />
      ) : years.isError ? (
        <ErrorState error={years.error} onRetry={() => void years.refetch()} />
      ) : (
        <DataTable
          caption="Academic years"
          data={years.data}
          columns={columns}
          getRowId={(y) => y.id}
          initialSort={{ id: "start", desc: true }}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">No academic years yet. Create one to start.</p>}
        />
      )}
      <YearFormDialog open={creating} onOpenChange={setCreating} />
      {editing ? <YearFormDialog open onOpenChange={(open) => !open && setEditing(null)} year={editing} /> : null}
      {activating ? <ActivateYearDialog year={activating} open onOpenChange={(open) => !open && setActivating(null)} /> : null}
      {completing ? <CompleteYearDialog year={completing} open onOpenChange={(open) => !open && setCompleting(null)} /> : null}
      {deleting ? (
        <DeleteRecordDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          what="academic year"
          name={deleting.name}
          consequence={<p className="text-muted-foreground">Only an empty draft year (no grades, timetables or generation runs) can be deleted. Its schedule is removed with it.</p>}
          onDelete={async () => {
            await yearsApi.remove(deleting.id);
            await queryClient.invalidateQueries({ queryKey: qk.years() });
            notifySuccess(`${deleting.name} deleted`);
          }}
        />
      ) : null}
    </Section>
  );
}

// Mirrors src/modules/admin/admin.schema.ts (createAdminSchema)
const adminSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200, "At most 200 characters"),
  email: z.string().trim().min(1, "Enter an email").email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .max(100, "At most 100 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[0-9]/, "Include a number"),
});

function AdminsSection() {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof adminSchema>>({ resolver: zodResolver(adminSchema), defaultValues: { name: "", email: "", password: "" } });
  const create = useMutation({
    mutationFn: authApi.createAdmin,
    onSuccess: (created) => {
      notifySuccess(`${created.name} can now sign in`, "Share the School ID from this page with them.");
      form.reset();
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) return form.setError("email", { message: error.message });
      const leftovers = applyServerErrors(error, form.setError, ["name", "email", "password"]);
      setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t add the administrator."));
    },
  });
  return (
    <Section title="Administrators" id="administrators">
      <Panel>
        <FormSection title="Add an administrator" description="Every administrator has the same access to this school. They sign in with the School ID, their email and this password.">
          <form onSubmit={form.handleSubmit((values) => { setFormError(null); create.mutate(values); })} noValidate className="space-y-4">
            <FieldGroup className="gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField control={form.control} name="name" label="Name" autoComplete="off" />
                <TextField control={form.control} name="email" label="Email" type="email" autoComplete="off" />
              </div>
              <TextField
                control={form.control}
                name="password"
                label="Initial password"
                type="password"
                autoComplete="new-password"
                description="8–100 characters with an uppercase letter, a lowercase letter and a number."
              />
            </FieldGroup>
            <FormAlert>{formError}</FormAlert>
            <PendingButton type="submit" pending={create.isPending}>
              Add administrator
            </PendingButton>
          </form>
        </FormSection>
      </Panel>
    </Section>
  );
}

const POLICY_COPY: Record<ConsecutivePeriodPolicy, { title: string; body: string }> = {
  ALLOW: { title: "Allow", body: "A substitute may be given four or more periods in a row without special handling." },
  PREFER_AVOID: {
    title: "Prefer to avoid (recommended)",
    body: "Four or more periods in a row is a last resort: offered only when no better teacher is free, and manual assignment asks for confirmation.",
  },
  NEVER_ALLOW: { title: "Never allow", body: "A substitute is never given four or more periods in a row, even if the lesson stays without cover." },
};

function PolicySection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: qk.substitutionSettings(), queryFn: substitutionSettingsApi.get });
  const update = useMutation({
    mutationFn: substitutionSettingsApi.update,
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.substitutionSettings(), saved);
      notifySuccess("Substitution policy saved", "It applies to new cover decisions.");
    },
    onError: (error) => notifyError(error, "Couldn’t save the policy"),
  });
  return (
    <Section title="Substitution policy" id="substitution-policy" description="How cover assignment treats a substitute who would teach four or more consecutive periods.">
      <Panel>
        {settings.isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : settings.isError ? (
          <ErrorState compact error={settings.error} onRetry={() => void settings.refetch()} />
        ) : (
          <RadioGroup
            value={settings.data.consecutivePeriodPolicy}
            onValueChange={(value) => update.mutate(value as ConsecutivePeriodPolicy)}
            disabled={update.isPending}
            aria-label="Consecutive period policy"
            className="gap-3"
          >
            {(Object.keys(POLICY_COPY) as ConsecutivePeriodPolicy[]).map((policy) => (
              <Label
                key={policy}
                htmlFor={`policy-${policy}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-accent/40"
              >
                <RadioGroupItem id={`policy-${policy}`} value={policy} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{POLICY_COPY[policy].title}</span>
                  <span className="block text-sm text-muted-foreground">{POLICY_COPY[policy].body}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}
      </Panel>
    </Section>
  );
}
