import { useMemo, useState } from "react";
import {
  findRecurring,
  findDuplicates,
  formatMoney,
  parseLocalDate,
} from "@capybudget/core";
import type {
  Transaction,
  RecurringPattern,
  DuplicateGroup,
} from "@capybudget/core";
import { cn } from "@/lib/utils";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import type { LockedFilters } from "@/components/budget/transactions-browser";

// ── Cadence badge ──

const CADENCE_STYLES: Record<RecurringPattern["cadence"], string> = {
  monthly: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  weekly: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  yearly: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  irregular: "bg-muted text-muted-foreground",
};

function CadenceBadge({ cadence }: { cadence: RecurringPattern["cadence"] }) {
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
        CADENCE_STYLES[cadence],
      )}
    >
      {cadence}
    </span>
  );
}

// ── Confidence badge ──

function ConfidenceBadge({ confidence }: { confidence: DuplicateGroup["confidence"] }) {
  return (
    <span
      className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
        confidence === "high"
          ? "bg-destructive/15 text-destructive"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      )}
    >
      {confidence === "high" ? "likely duplicate" : "possible"}
    </span>
  );
}

// ── Date formatting ──

function formatShortDate(iso: string): string {
  const d = parseLocalDate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Drilldown state ──

interface DrilldownState {
  title: string;
  subtitle: string;
  transactionIds: Set<string>;
  lockedFilters: LockedFilters;
}

// ── Subscription card ──

function SubscriptionCard({
  pattern,
  onDrilldown,
}: {
  pattern: RecurringPattern;
  onDrilldown: (state: DrilldownState) => void;
}) {
  function handleClick() {
    onDrilldown({
      title: pattern.merchant,
      subtitle: `${pattern.cadence} · ${pattern.transactionCount} transactions`,
      transactionIds: new Set(pattern.transactionIds),
      lockedFilters: { merchant: pattern.merchant },
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold truncate">{pattern.merchant}</h4>
        <CadenceBadge cadence={pattern.cadence} />
      </div>

      <p className="mt-2 text-lg font-semibold tabular-nums">
        {formatMoney(pattern.avgAmount)}
        <span className="text-sm font-normal text-muted-foreground">/avg</span>
        {pattern.variance === "variable" && (
          <span className="ml-1.5 text-xs text-muted-foreground">±varies</span>
        )}
      </p>

      <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
        <p>Next: {formatShortDate(pattern.nextExpected)}</p>
        <p>Total: {formatMoney(pattern.totalSpent)}</p>
        <p>{pattern.transactionCount} transactions</p>
      </div>
    </button>
  );
}

// ── Duplicate card ──

function DuplicateCard({
  group,
  onDrilldown,
}: {
  group: DuplicateGroup;
  onDrilldown: (state: DrilldownState) => void;
}) {
  function handleClick() {
    onDrilldown({
      title: group.merchant || "Unknown",
      subtitle: `${group.confidence} confidence · ${group.transactionIds.length} transactions`,
      transactionIds: new Set(group.transactionIds),
      lockedFilters: group.merchant ? { merchant: group.merchant } : {},
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50 cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold truncate">
            {group.merchant || "Unknown"}
          </h4>
          <p className="text-xs text-muted-foreground">
            {formatShortDate(group.date)}
          </p>
        </div>
        <ConfidenceBadge confidence={group.confidence} />
      </div>

      <p className="mt-2 text-lg font-semibold tabular-nums">
        {formatMoney(group.amount)}
      </p>

      <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
        <p>{group.reason}</p>
        <p>{group.transactionIds.length} transactions</p>
      </div>
    </button>
  );
}

// ── Main ──

interface PatternsTabProps {
  transactions: Transaction[];
}

export function PatternsTab({ transactions }: PatternsTabProps) {
  const recurring = useMemo(() => findRecurring(transactions), [transactions]);
  const duplicates = useMemo(() => findDuplicates(transactions), [transactions]);

  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  const drilldownTransactions = useMemo(() => {
    if (!drilldown) return [];
    return transactions.filter((t) => drilldown.transactionIds.has(t.id));
  }, [drilldown, transactions]);

  return (
    <div className="space-y-8 pt-4">
      {/* Subscriptions */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Subscriptions ({recurring.length})
        </h3>
        {recurring.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No recurring patterns found. Patterns are detected when a merchant
            appears 3 or more times.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recurring.map((p) => (
              <SubscriptionCard
                key={p.merchant}
                pattern={p}
                onDrilldown={setDrilldown}
              />
            ))}
          </div>
        )}
      </section>

      {/* Duplicates */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          Duplicates ({duplicates.length})
        </h3>
        {duplicates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No duplicate transactions found.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {duplicates.map((g) => (
              <DuplicateCard
                key={g.transactionIds.join(",")}
                group={g}
                onDrilldown={setDrilldown}
              />
            ))}
          </div>
        )}
      </section>

      <TransactionsModal
        open={drilldown !== null}
        onOpenChange={(open) => !open && setDrilldown(null)}
        transactions={drilldownTransactions}
        lockedFilters={drilldown?.lockedFilters ?? {}}
        title={drilldown?.title ?? ""}
        subtitle={drilldown?.subtitle}
      />
    </div>
  );
}
