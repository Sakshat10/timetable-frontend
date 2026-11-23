import type { Metadata } from "next";
import { SignupFlow } from "@/features/auth/signup-flow";

export const metadata: Metadata = { title: "Set up your school" };

export default function SignupPage() {
  return <SignupFlow />;
}
