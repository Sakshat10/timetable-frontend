"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { applyServerErrors, FormAlert, SelectField, TextField } from "@/components/shared/form-fields";
import { PendingButton } from "@/components/shared/confirm-dialog";
import { authApi, schoolApi } from "@/lib/api/endpoints";
import { resetUnauthorizedSignal } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import type { CreatedSchool } from "@/lib/api/types";
import { LAST_SCHOOL_ID_KEY } from "./login-form";

// Mirrors src/modules/school/school.schema.ts
const schoolSchema = z.object({
  name: z.string().trim().min(1, "Enter the school’s name").max(200, "At most 200 characters"),
  code: z
    .string()
    .trim()
    .min(1, "Enter a short code")
    .max(50, "At most 50 characters")
    .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, numbers, hyphens and underscores only"),
  schoolType: z.enum(["PRIMARY", "SECONDARY", "CUSTOM"]),
});
// Mirrors src/modules/admin/admin.schema.ts (passwordSchema)
const adminSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200, "At most 200 characters"),
  email: z.string().trim().min(1, "Enter your email").email("Enter a valid email address"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .max(100, "At most 100 characters")
    .regex(/[A-Z]/, "Include an uppercase letter")
    .regex(/[a-z]/, "Include a lowercase letter")
    .regex(/[0-9]/, "Include a number"),
});

type Step = "school" | "admin";

/**
 * Sign-up: POST /schools (returns a one-time setup token) -> POST /admin/register -> POST /admin/login.
 * The setup token is kept in component memory only and never stored (AUTH-PROXY-TEST-PLAN T1.6).
 */
export function SignupFlow() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("school");
  const [school, setSchool] = useState<CreatedSchool | null>(null);
  const [schoolError, setSchoolError] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const schoolForm = useForm<z.infer<typeof schoolSchema>>({ resolver: zodResolver(schoolSchema), defaultValues: { name: "", code: "", schoolType: "SECONDARY" } });
  const adminForm = useForm<z.infer<typeof adminSchema>>({ resolver: zodResolver(adminSchema), defaultValues: { name: "", email: "", password: "" } });

  async function createSchool(values: z.infer<typeof schoolSchema>) {
    setSchoolError(null);
    try {
      const created = await schoolApi.create({ ...values, code: values.code.trim().toUpperCase() });
      setSchool(created);
      setStep("admin");
    } catch (error) {
      if (isApiError(error) && error.status === 429) {
        setSchoolError("A school was already created from this network recently. Try again later, or sign in to the existing school.");
        return;
      }
      if (isApiError(error) && error.status === 409) {
        schoolForm.setError("code", { message: "This code is already used by another school" });
        return;
      }
      const leftovers = applyServerErrors(error, schoolForm.setError, ["name", "code", "schoolType"]);
      setSchoolError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t create the school."));
    }
  }

  async function createAdmin(values: z.infer<typeof adminSchema>) {
    if (!school) return;
    setAdminError(null);
    try {
      await authApi.register({ schoolId: school.id, setupToken: school.setupToken, ...values });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setAdminError("The setup token has expired or was already used. An operator can issue a new one for this school.");
        return;
      }
      if (isApiError(error) && error.status === 409) {
        setAdminError(error.message);
        return;
      }
      if (isApiError(error) && error.status === 429) {
        setAdminError("Too many registration attempts. Please wait and try again.");
        return;
      }
      const leftovers = applyServerErrors(error, adminForm.setError, ["name", "email", "password"]);
      setAdminError(leftovers[0] ?? (isApiError(error) ? error.message : "Couldn’t create the administrator."));
      return;
    }
    try {
      localStorage.setItem(LAST_SCHOOL_ID_KEY, school.id);
    } catch {
      /* convenience only */
    }
    try {
      await authApi.login({ schoolId: school.id, email: values.email, password: values.password });
      resetUnauthorizedSignal();
      queryClient.clear();
      setSchool(null); // drop the setup token from memory
      router.replace("/setup/start");
      router.refresh();
    } catch {
      router.replace("/login");
    }
  }

  if (step === "admin" && school) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create your administrator account</CardTitle>
          <CardDescription>{school.name} has been created. Keep your School ID: you need it to sign in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">School ID</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm" data-testid="school-id">
                {school.id}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(school.id).then(() => setCopied(true));
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
          <form onSubmit={adminForm.handleSubmit(createAdmin)} noValidate className="space-y-5">
            <FieldGroup className="gap-4">
              <TextField control={adminForm.control} name="name" label="Your name" autoComplete="name" autoFocus />
              <TextField control={adminForm.control} name="email" label="Email" type="email" autoComplete="email" />
              <TextField
                control={adminForm.control}
                name="password"
                label="Password"
                type="password"
                autoComplete="new-password"
                description="8–100 characters with an uppercase letter, a lowercase letter and a number."
              />
            </FieldGroup>
            <FormAlert>{adminError}</FormAlert>
            <PendingButton type="submit" className="w-full" size="lg" pending={adminForm.formState.isSubmitting}>
              Create account and continue
            </PendingButton>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Set up your school</CardTitle>
        <CardDescription>Create the school, then its first administrator account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={schoolForm.handleSubmit(createSchool)} noValidate className="space-y-5">
          <FieldGroup className="gap-4">
            <TextField control={schoolForm.control} name="name" label="School name" autoComplete="organization" autoFocus />
            <TextField
              control={schoolForm.control}
              name="code"
              label="Short code"
              description="Uppercase letters, numbers, hyphens and underscores, e.g. GREENFIELD-HS."
            />
            <SelectField
              control={schoolForm.control}
              name="schoolType"
              label="School type"
              options={[
                { value: "PRIMARY", label: "Primary" },
                { value: "SECONDARY", label: "Secondary" },
                { value: "CUSTOM", label: "Other" },
              ]}
            />
          </FieldGroup>
          <FormAlert>{schoolError}</FormAlert>
          <PendingButton type="submit" className="w-full" size="lg" pending={schoolForm.formState.isSubmitting}>
            Create school
          </PendingButton>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already set up?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
