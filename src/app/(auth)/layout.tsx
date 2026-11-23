import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
              <CalendarDays className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">Timetable Maker</span>
          </div>
          {children}
        </div>
      </div>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">School timetable planning and daily cover management</footer>
    </div>
  );
}
