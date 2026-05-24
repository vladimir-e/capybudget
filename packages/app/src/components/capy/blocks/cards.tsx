/**
 * Shared sub-components for surfacing pattern intelligence — duplicate
 * groups and recurring patterns. Both the Capy chat blocks and the
 * Patterns analytics tab render these, so the visual and interaction
 * vocabulary stays in one place.
 *
 * Cards are presentation-only: they accept already-formed pattern data
 * and an `onReview` / `onView` callback. The host decides what "review"
 * means — typically opening a TransactionsModal scoped to the pattern's
 * transactionIds.
 */

import { AlertTriangle, ChevronRight, Repeat } from "lucide-react";
import { formatMoney } from "@capybudget/core";
import type {
  DuplicateGroupSummary,
  RecurringPatternSummary,
} from "@capybudget/intelligence";

const CADENCE_LABEL: Record<RecurringPatternSummary["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  irregular: "Irregular",
};

export interface DuplicateGroupCardProps {
  group: DuplicateGroupSummary;
  onReview: () => void;
}

export function DuplicateGroupCard({ group, onReview }: DuplicateGroupCardProps) {
  const confidenceColor =
    group.confidence === "high"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-muted text-muted-foreground";
  const merchantLabel = group.merchant.trim() || "Unknown merchant";

  return (
    <button
      type="button"
      onClick={onReview}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{merchantLabel}</span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${confidenceColor}`}
          >
            {group.confidence}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {group.transactionIds.length} transactions · {formatMoney(group.amount)} · {group.date}
        </div>
        {group.summary && (
          <div className="mt-1 text-xs text-muted-foreground">{group.summary}</div>
        )}
        <div className="mt-0.5 text-[11px] text-muted-foreground/80">{group.reason}</div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-brand" />
    </button>
  );
}

export interface SubscriptionCardProps {
  pattern: RecurringPatternSummary;
  onView: () => void;
}

export function SubscriptionCard({ pattern, onView }: SubscriptionCardProps) {
  const cadenceLabel = CADENCE_LABEL[pattern.cadence];
  const merchantLabel = pattern.merchant || "Unknown merchant";

  return (
    <button
      type="button"
      onClick={onView}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
    >
      <Repeat className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="truncate">{merchantLabel}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {cadenceLabel}
          </span>
          {pattern.amountVariance === "variable" && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Variable
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {formatMoney(pattern.averageAmount)} avg · {pattern.transactionIds.length} charges · {formatMoney(pattern.totalSpent)} total
        </div>
        {pattern.nextExpected && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/80">
            Next expected: {pattern.nextExpected}
          </div>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-brand" />
    </button>
  );
}
