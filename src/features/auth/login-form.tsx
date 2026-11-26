"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { FieldGroup } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { applyServerErrors, FormAlert, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { authApi } from "@/lib/api/endpoints";
import { resetUnauthorizedSignal } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { safeNextPath } from "@/lib/safe-redirect";

export const LAST_SCHOOL_ID_KEY = "tt.lastSchoolId";

// Mirrors src/modules/admin/admin.schema.ts (loginAdminSchema).
const schema = z.object({
  schoolId: z.string().trim().min(1, "Enter your School ID").uuid("A School ID looks like 3f2b…-…: check the ID you were given when the school was created"),
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const expired = params.get("reason") === "expired";

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { schoolId: "", email: "", password: "" } });

  useEffect(() => {
    try {
      const remembered = localStorage.getItem(LAST_SCHOOL_ID_KEY);
      if (remembered && !form.getValues("schoolId")) form.setValue("schoolId", remembered);
    } catch {
      /* storage unavailable: the user types the ID */
    }
  }, [form]);

  async function onSubmit(values: Values) {
    setFormError(null);
    try {
      await authApi.login({ schoolId: values.schoolId.trim(), email: values.email.trim(), password: values.password });
      try {
        localStorage.setItem(LAST_SCHOOL_ID_KEY, values.schoolId.trim());
      } catch {
        /* convenience only */
      }
      resetUnauthorizedSignal();
      queryClient.clear();
      router.replace(safeNextPath(params.get("next")));
      router.refresh();
    } catch (error) {
      form.setValue("password", "");
      if (isApiError(error) && error.status === 401) {
        setFormError("The School ID, email or password is not correct.");
      } else if (isApiError(error) && error.status === 429) {
        setFormError("Too many sign-in attempts. Please wait up to 15 minutes and try again.");
      } else {
        const leftovers = applyServerErrors(error, form.setError, ["schoolId", "email", "password"]);
        setFormError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t sign in. Please try again."));
      }
    }
  }

  return (
    <Card className="gap-6 rounded-2xl py-8 shadow-raised [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)]">
      <CardHeader className="gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground" data-slot="card-title">
          Sign in
        </h1>
        <CardDescription className="text-[15px]">Welcome back. Use your school’s ID and your administrator account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {expired ? (
          <div role="status" className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-primary-soft/70 px-3.5 py-3 text-sm text-secondary-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Your session ended. Sign in again to continue where you left off.
          </div>
        ) : null}
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
          <FieldGroup className="gap-4">
            <TextField
              control={form.control}
              name="schoolId"
              label="School ID"
              autoComplete="organization"
              description="The ID shown when your school was created (also in Settings)."
            />
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="username" />
            <TextField control={form.control} name="password" label="Password" type="password" autoComplete="current-password" />
          </FieldGroup>
          <FormAlert>{formError}</FormAlert>
          <PendingButton type="submit" className="h-11 w-full text-[15px]" size="lg" pending={form.formState.isSubmitting}>
            Sign in
          </PendingButton>
        </form>
        <p className="border-t pt-5 text-center text-sm text-muted-foreground">
          New school?{" "}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            Set up your school
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
