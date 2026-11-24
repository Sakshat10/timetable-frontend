import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  GitBranch,
  GraduationCap,
  ListChecks,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { LandingNav } from "./landing-nav";
import { ProductPreview } from "./product-preview";

/*
 * Public landing page. Every statement describes a capability the product really has (see
 * docs/architecture/FEATURE-API-MATRIX.md); there are no metrics, testimonials, customer logos, prices or contact
 * details, because none exist to show.
 */

const FEATURES: Array<{ icon: ReactNode; title: string; body: string }> = [
  {
    icon: <GraduationCap />,
    title: "Classes, streams and sections",
    body: "Model your school as it really is: grades, optional streams such as Science and Commerce, and the sections inside them.",
  },
  {
    icon: <BookOpen />,
    title: "Subjects and curriculum",
    body: "Set how many periods each subject needs per week for every grade or stream, with a clear view of weekly capacity.",
  },
  {
    icon: <Users />,
    title: "Teachers and eligibility",
    body: "Record who can teach what, pin specific teachers to specific classes, and see each teacher’s week at a glance.",
  },
  {
    icon: <Sparkles />,
    title: "Automatic generation",
    body: "A readiness review checks your setup first, then the generator builds a full timetable that respects your rules.",
  },
  {
    icon: <GitBranch />,
    title: "Drafts, review and publishing",
    body: "Work in drafts, move or swap lessons, lock the ones you want to keep, and publish when the timetable is right.",
  },
  {
    icon: <CalendarCheck2 />,
    title: "Daily cover and absences",
    body: "Record teacher absences and unavailable periods, then assign a substitute to every lesson that needs cover.",
  },
];

const STEPS: Array<{ title: string; body: string; icon: ReactNode }> = [
  {
    icon: <ListChecks />,
    title: "Set up your school year",
    body: "Add classes, subjects, the curriculum, teachers and your weekly schedule. The setup guide shows what is left to do.",
  },
  {
    icon: <CalendarRange />,
    title: "Generate and refine",
    body: "Run the readiness review, generate a draft timetable, then adjust lessons by hand until it works for everyone.",
  },
  {
    icon: <UserRoundCheck />,
    title: "Publish and run the day",
    body: "Publish the timetable for the year, then handle absences and cover from one daily view.",
  },
];

const BENEFITS: Array<{ title: string; body: string }> = [
  { title: "Problems caught before they spread", body: "Readiness checks flag subjects without an eligible teacher, overloaded weeks and other setup issues before a timetable is generated." },
  { title: "Changes without risk", body: "Drafts are kept separate from the published timetable, so you can experiment freely and publish only when ready." },
  { title: "Rules the timetable respects", body: "Teacher eligibility, pinned assignments and your weekly schedule are taken into account when lessons are placed." },
  { title: "A calmer start to every day", body: "See which lessons need cover today and assign a substitute in a few clicks." },
  { title: "Each academic year in its own space", body: "Plan next year as a draft while the current year stays active and untouched." },
  { title: "Built for the whole team", body: "A clear, consistent interface that works on a desktop in the office and on a phone in the corridor." },
];

export function LandingPage() {
  const year = new Date().getFullYear();
  return (
    <div className="min-h-screen bg-surface text-foreground">
      <a
        href="#content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to main content
      </a>
      <div className="relative">
        {/* Soft canvas behind the hero only. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary-soft via-primary-soft/40 to-surface" />
        <div className="relative">
          <LandingNav />
          <main id="content" tabIndex={-1} className="outline-none">
            {/* Hero */}
            <section aria-labelledby="hero-title" className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12 lg:px-8 lg:pt-20 lg:pb-24">
              <div className="max-w-xl">
                <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-surface px-3 py-1 text-xs font-semibold text-accent-foreground shadow-xs">
                  <CalendarRange className="size-3.5" aria-hidden /> School timetable planning
                </p>
                <h1 id="hero-title" className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.5rem]">
                  Create smarter school timetables. <span className="text-primary">Without the chaos.</span>
                </h1>
                <p className="mt-6 text-lg leading-8 text-pretty text-muted-foreground">
                  Timetable Maker brings classes, subjects, teachers and schedules together, generates a timetable that respects your rules,
                  and keeps daily cover under control.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Button asChild size="lg" className="h-11 px-5 text-[15px]">
                    <Link href="/signup">
                      Get started <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-11 px-5 text-[15px]">
                    <Link href="/login">Sign in</Link>
                  </Button>
                </div>
                <p className="mt-5 text-sm text-muted-foreground">Create your school and administrator account to begin.</p>
              </div>
              <ProductPreview className="lg:translate-x-4" />
            </section>
          </main>
        </div>
      </div>

      {/* Features */}
      <section id="features" aria-labelledby="features-title" className="scroll-mt-20 border-t bg-background py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionIntro eyebrow="Features" id="features-title" title="Everything a timetable needs, in one place">
            From the structure of your school to the cover for today’s absences, each step builds on the last.
          </SectionIntro>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="rounded-xl border bg-surface p-6 shadow-card">
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-5" aria-hidden>
                  {feature.icon}
                </span>
                <h3 className="mt-5 text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <SectionIntro eyebrow="How it works" id="how-title" title="From a blank year to a running school">
            Three steps, guided the whole way.
          </SectionIntro>
          <ol className="mt-12 grid gap-6 lg:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative rounded-xl border bg-surface p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground tabular" aria-hidden>
                    {index + 1}
                  </span>
                  <span className="text-primary [&_svg]:size-5" aria-hidden>
                    {step.icon}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-semibold">
                  <span className="sr-only">Step {index + 1}: </span>
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" aria-labelledby="benefits-title" className="scroll-mt-20 border-t bg-background py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
          <div>
            <SectionIntro eyebrow="Benefits" id="benefits-title" title="Less firefighting, more confidence" align="left">
              Timetabling is one of the hardest jobs in a school. Timetable Maker keeps the moving parts in order so you can focus on decisions,
              not spreadsheets.
            </SectionIntro>
            <div className="mt-8 hidden items-start gap-3 rounded-xl border bg-surface p-5 shadow-card lg:flex">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p className="text-sm leading-6 text-muted-foreground">
                Your published timetable is never changed by accident: every edit happens in a draft first.
              </p>
            </div>
          </div>
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit.title} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <h3 className="text-[15px] font-semibold">{benefit.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{benefit.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final call to action */}
      <section aria-labelledby="cta-title" className="px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground shadow-raised sm:px-12 sm:py-16">
          <h2 id="cta-title" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Make school timetable management simpler.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-primary-foreground">
            Create your school’s account and start setting up your first academic year today.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="outline" className="h-11 border-transparent bg-surface px-5 text-[15px] text-primary hover:bg-primary-soft">
              <Link href="/signup">
                Get started <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" className="h-11 border border-primary-foreground/30 bg-transparent px-5 text-[15px] shadow-none hover:bg-primary-foreground/10">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="space-y-2">
            <Logo />
            <p className="text-sm text-muted-foreground">School timetable planning and daily cover management.</p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <li>
                <a href="#features" className="text-muted-foreground hover:text-foreground">
                  Features
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="text-muted-foreground hover:text-foreground">
                  How it works
                </a>
              </li>
              <li>
                <Link href="/login" className="text-muted-foreground hover:text-foreground">
                  Sign in
                </Link>
              </li>
              <li>
                <Link href="/signup" className="text-muted-foreground hover:text-foreground">
                  Get started
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className="border-t">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">© {year} Timetable Maker</p>
        </div>
      </footer>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  id,
  children,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  id: string;
  children: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-sm font-semibold text-primary">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-7 text-muted-foreground">{children}</p>
    </div>
  );
}
