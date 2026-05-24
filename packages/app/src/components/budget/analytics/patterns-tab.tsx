/**
 * Patterns tab: recurring subscriptions + duplicate transactions.
 *
 * Pattern detection wants the full transaction window — both functions
 * already apply their own scoping internally (lookback for recurring,
 * pairwise comparison for duplicates), so the analytics date range UI
 * is intentionally bypassed here. The tab hides the date-range nav.
 *
 * Reuses the same card sub-components the Capy chat blocks render — a
 * group / pattern looks identical whether the entry point was a model
 * tool call or a tab click. Clicking a card opens the same
 * `TransactionsModal` scoped to that group/pattern's transactionIds.
 */

import { useMemo, useState } from "react";
import {
  findDuplicates,
  findRecurring,
  type DuplicateGroup,
  type RecurringPattern,
  type Transaction,
} from "@capybudget/core";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import {
  DuplicateGroupCard,
  SubscriptionCard,
} from "@/components/capy/blocks/cards";

interface PatternsTabProps {
  transactions: Transaction[];
}

export function PatternsTab({ transactions }: PatternsTabProps) {
  const recurring = useMemo(() => findRecurring(transactions), [transactions]);
  const duplicates = useMemo(() => findDuplicates(transactions), [transactions]);

  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalSubtitle, setModalSubtitle] = useState<string | undefined>();

  function openPattern(pattern: RecurringPattern) {
    setOpenIds(new Set(pattern.transactionIds));
    setModalTitle(pattern.merchant || "Recurring");
    setModalSubtitle(`${pattern.transactionIds.length} charges`);
  }

  function openGroup(group: DuplicateGroup) {
    setOpenIds(new Set(group.transactionIds));
    setModalTitle("Review duplicates");
    setModalSubtitle(group.reason);
  }

  return (
    <div className="space-y-6 pt-4">
      <Section title="Subscriptions" emptyHint="No recurring patterns detected yet — Capy needs at least three transactions from the same merchant within 18 months.">
        {recurring.map((pattern) => (
          <SubscriptionCard
            key={pattern.id}
            pattern={pattern}
            onView={() => openPattern(pattern)}
          />
        ))}
      </Section>

      <Section title="Duplicates" emptyHint="No likely duplicates in your budget. Nice and tidy.">
        {duplicates.map((group) => (
          <DuplicateGroupCard
            key={group.id}
            group={group}
            onReview={() => openGroup(group)}
          />
        ))}
      </Section>

      <TransactionsModal
        open={openIds !== null}
        onOpenChange={(o) => {
          if (!o) setOpenIds(null);
        }}
        transactions={transactions}
        lockedFilters={openIds ? { transactionIds: openIds } : {}}
        title={modalTitle}
        subtitle={modalSubtitle}
      />
    </div>
  );
}

function Section({
  title,
  children,
  emptyHint,
}: {
  title: string;
  children: React.ReactNode;
  emptyHint: string;
}) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.length === 0 || items.every((c) => !c);

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {isEmpty ? (
        <p className="rounded-xl border border-dashed border-border/40 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}
