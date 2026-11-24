import { AlertTriangle, CheckCircle2, Circle, CircleDashed, HelpCircle, Lock } from "lucide-react";
import type { StepState } from "./progress";

export const STEP_LABEL: Record<StepState, string> = {
  done: "Done",
  todo: "To do",
  attention: "Needs attention",
  optional: "Optional",
  locked: "Closed",
  unknown: "Unknown",
};

export function StepIcon({ state, className = "size-5" }: { state: StepState; className?: string }) {
  switch (state) {
    case "done":
      return <CheckCircle2 className={`${className} text-success`} aria-hidden />;
    case "attention":
      return <AlertTriangle className={`${className} text-warning`} aria-hidden />;
    case "optional":
      return <CircleDashed className={`${className} text-muted-foreground`} aria-hidden />;
    case "locked":
      return <Lock className={`${className} text-muted-foreground`} aria-hidden />;
    case "unknown":
      return <HelpCircle className={`${className} text-muted-foreground`} aria-hidden />;
    default:
      return <Circle className={`${className} text-muted-foreground`} aria-hidden />;
  }
}
