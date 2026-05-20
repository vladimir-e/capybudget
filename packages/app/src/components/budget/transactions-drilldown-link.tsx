import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TransactionsDrilldownLinkProps {
  onClick: () => void;
  /** Screen-reader label, used for `aria-label` when the visible text alone
   *  isn't self-describing (e.g. a bare dollar amount). */
  ariaLabel?: string;
  /** Pass-through className for layout overrides on the call site (e.g.
   *  `text-right tabular-nums` inside a grid cell). Keep visual concerns
   *  here in the component itself — alignment goes on the caller. */
  className?: string;
  children: ReactNode;
}

/** Shared affordance for "this number opens the transactions browser
 *  pre-filtered to its context." Subtle dashed underline so a row of
 *  numbers in a chart breakdown doesn't read as a busy stack of links,
 *  but the dash still signals "interactive" — solidifies on hover.
 *
 *  Define the style here once so every drilldown across the analytics
 *  tabs shares the same visual. If we tweak the affordance later (color,
 *  underline offset, etc.) this is the single source of truth.
 *
 *  Not a button-shaped target on purpose: these are inline values inside
 *  table cells / KPI cards, not actions. Native `<button>` underneath
 *  for keyboard activation + focus ring. */
export function TransactionsDrilldownLink({
  onClick,
  ariaLabel,
  className,
  children,
}: TransactionsDrilldownLinkProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        // Inline-by-default so the link sits naturally in a number cell
        // or a row of text. Callers can override layout via `className`.
        "inline-flex cursor-pointer underline decoration-dashed decoration-muted-foreground/60 underline-offset-4 transition-colors hover:decoration-solid hover:decoration-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:rounded-sm",
        className,
      )}
    >
      {children}
    </button>
  );
}
