import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/** Sign-in and sign-up: a calm, centred layout on a light canvas. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-primary-soft to-transparent" />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Timetable Maker home">
          <Logo />
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Back to home
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pt-6 pb-12 sm:items-center sm:pt-0">
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
      <footer className="relative px-4 pb-6 text-center text-xs text-muted-foreground">School timetable planning and daily cover management</footer>
    </div>
  );
}
