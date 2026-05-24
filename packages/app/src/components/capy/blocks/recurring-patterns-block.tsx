/**
 * Chat block: render the result of `find_recurring` as a vertical list
 * of subscription cards. Clicking opens TransactionsModal scoped to that
 * pattern's transactionIds.
 */

import { useState } from "react";
import { useTransactions } from "@/hooks/use-budget-data";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { SubscriptionCard } from "./cards";
import type {
  RecurringPatternSummary,
  RecurringPatternsBlock,
} from "@capybudget/intelligence";

export function RecurringPatternsBlockView({ block }: { block: RecurringPatternsBlock }) {
  const { data: allTransactions = [] } = useTransactions();
  const [openPattern, setOpenPattern] = useState<RecurringPatternSummary | null>(null);

  return (
    <>
      <div className="space-y-2">
        {block.patterns.map((pattern, i) => (
          <SubscriptionCard
            key={`${pattern.merchant}-${i}`}
            pattern={pattern}
            onView={() => setOpenPattern(pattern)}
          />
        ))}
      </div>
      <TransactionsModal
        open={openPattern !== null}
        onOpenChange={(o) => !o && setOpenPattern(null)}
        transactions={allTransactions}
        lockedFilters={
          openPattern
            ? { transactionIds: new Set(openPattern.transactionIds) }
            : {}
        }
        title={openPattern?.merchant ?? "Recurring"}
        subtitle={openPattern ? `${openPattern.transactionIds.length} charges` : undefined}
      />
    </>
  );
}
