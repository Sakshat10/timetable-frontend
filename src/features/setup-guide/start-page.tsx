"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { applyServerErrors, FormAlert, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { PageBody, PageHeader } from "@/components/shared/page-header";
import { ErrorState } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/features/auth/session-provider";
import { yearSchema, type YearValues } from "@/features/academic-years/year-form";
import { YearStatusBadge } from "@/features/academic-years/year-status-badge";
import { yearsApi } from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { formatDateRange, isoDatePart } from "@/lib/dates";
import { notifySuccess } from "@/lib/notify";
import { qk } from "@/lib/query/keys";

/** First run: a school without any academic year starts here, then continues in the Setup guide. */
export function SetupStartPage() {
  const router = useRouter();
  const { school } = useSession();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const years = useQuery({ queryKey: qk.years(), queryFn: yearsApi.list });
  const form = useForm<YearValues>({ resolver: zodResolver(yearSchema), defaultValues: { name: "", startDate: "", endDate: "" } });
  const create = useMutation({
    mutationFn: yearsApi.create,
    onSuccess: async (year) => {
      await queryClient.invalidateQueries({ queryKey: qk.years() });
      notifySuccess(`Academic year ${year.name} created`);
      router.push(`/years/${year.id}/setup`);
    },
    onError: (error) => {
      if (isApiError(error) && error.status === 409) return form.setError("name", { message: error.message });
      const leftovers = applyServerErrors(error, form.setError, ["name", "startDate", "endDate"]);
      setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t create the academic year."));
    },
  });

  return (
    <PageBody className="max-w-3xl">
      <PageHeader
        title={`Welcome to ${school.name}`}
        description="Start with an academic year. Everything else (classes, curriculum, teachers, the schedule and timetables) belongs to a year."
      />
      {years.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : years.isError ? (
        <ErrorState error={years.error} onRetry={() => void years.refetch()} />
      ) : (
        <>
          {years.data.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your academic years</CardTitle>
                <CardDescription>Open a year to continue its setup, or create another one below.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {years.data.map((year) => (
                  <div key={year.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {year.name} <YearStatusBadge status={year.status} compact />
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateRange(isoDatePart(year.startDate), isoDatePart(year.endDate))}</p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/years/${year.id}/setup`}>Open setup guide</Link>
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarPlus className="size-4" aria-hidden /> {years.data.length > 0 ? "Create another academic year" : "Create your first academic year"}
              </CardTitle>
              <CardDescription>New years start as drafts, so you can set them up and generate timetables freely.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={form.handleSubmit((values) => { setFormError(null); create.mutate(values); })} noValidate className="space-y-5">
                <FieldGroup className="gap-4">
                  <TextField control={form.control} name="name" label="Name" placeholder="2027-28" />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField control={form.control} name="startDate" label="Start date" type="date" />
                    <TextField control={form.control} name="endDate" label="End date" type="date" />
                  </div>
                </FieldGroup>
                <FormAlert>{formError}</FormAlert>
                <PendingButton type="submit" pending={create.isPending}>
                  Create and continue
                </PendingButton>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </PageBody>
  );
}
