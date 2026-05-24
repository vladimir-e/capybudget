/**
 * Chat block: a clickable pill summarizing a transaction selection.
 * Clicking opens the app's TransactionsModal, scoped to whatever filter
 * the model emitted. The block owns its own open/closed state and looks
 * the actual Transaction objects up from React Query.
 */

import { useMemo, useState } from "react";
import { ChevronRight, ListFilter } from "lucide-react";
import { useTransactions } from "@/hooks/use-budget-data";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import type { LockedFilters } from "@/components/budget/transactions-browser";
import type { TransactionsBlock } from "@capybudget/intelligence";

export function TransactionsCardBlock({ block }: { block: TransactionsBlock }) {
  const [open, setOpen] = useState(false);
  const { data: allTransactions = [] } = useTransactions();

  const lockedFilters = useMemo<LockedFilters>(
    () => toLockedFilters(block.filter),
    [block.filter],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
      >
        <ListFilter className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-brand" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{block.label}</div>
          <div className="text-xs text-muted-foreground">
            {block.count} {block.count === 1 ? "transaction" : "transactions"}
            {block.summary ? ` · ${block.summary}` : ""}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-brand" />
      </button>
      <TransactionsModal
        open={open}
        onOpenChange={setOpen}
        transactions={allTransactions}
        lockedFilters={lockedFilters}
        title={block.label}
        subtitle={block.summary}
      />
    </>
  );
}

function toLockedFilters(filter: TransactionsBlock["filter"]): LockedFilters {
  const out: LockedFilters = {};
  if (filter.transactionIds && filter.transactionIds.length > 0) {
    out.transactionIds = new Set(filter.transactionIds);
  }
  if (filter.categoryId !== undefined) out.categoryId = filter.categoryId;
  if (filter.merchant !== undefined) out.merchant = filter.merchant;
  if (filter.dateRange) {
    out.dateRange = {
      from: new Date(filter.dateRange.from),
      // LockedFilters.to is exclusive; the model passes inclusive dates,
      // so bump end by one day.
      to: addDays(new Date(filter.dateRange.to), 1),
    };
  }
  if (filter.amountRange) out.amountRange = filter.amountRange;
  if (filter.type) out.type = filter.type;
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}
