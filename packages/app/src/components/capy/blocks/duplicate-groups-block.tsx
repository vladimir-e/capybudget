/**
 * Chat block: render the result of `find_duplicates` as a vertical list
 * of group cards. Clicking "Review" opens TransactionsModal scoped to
 * that group's transactionIds so the user can resolve in place.
 */

import { useState } from "react";
import { useTransactions } from "@/hooks/use-budget-data";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { DuplicateGroupCard } from "./cards";
import type {
  DuplicateGroupSummary,
  DuplicateGroupsBlock,
} from "@capybudget/intelligence";

export function DuplicateGroupsBlockView({ block }: { block: DuplicateGroupsBlock }) {
  const { data: allTransactions = [] } = useTransactions();
  const [openGroup, setOpenGroup] = useState<DuplicateGroupSummary | null>(null);

  return (
    <>
      <div className="space-y-2">
        {block.groups.map((group, i) => (
          <DuplicateGroupCard
            key={`${group.date}-${group.transactionIds.join("-")}-${i}`}
            group={group}
            onReview={() => setOpenGroup(group)}
          />
        ))}
      </div>
      <TransactionsModal
        open={openGroup !== null}
        onOpenChange={(o) => !o && setOpenGroup(null)}
        transactions={allTransactions}
        lockedFilters={
          openGroup
            ? { transactionIds: new Set(openGroup.transactionIds) }
            : {}
        }
        title="Review duplicates"
        subtitle={openGroup?.reason}
      />
    </>
  );
}
