import { createFileRoute } from "@tanstack/react-router";
import { TransactionView } from "@/components/budget/transaction-view";
import { AddTransactionButton } from "@/components/budget/add-transaction-button";
import { useBudgetLabels } from "@/lib/use-budget-labels";
import { useTransactions } from "@/hooks/use-budget-data";

export const Route = createFileRoute("/budget/_shell/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const labels = useBudgetLabels();
  const { data: transactions = [] } = useTransactions();

  return (
    <TransactionView
      transactions={transactions}
      showAccountColumn={true}
      header={
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{labels.allAccounts()}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {labels.transactionCount(transactions.length)}
            </p>
          </div>
          <AddTransactionButton />
        </div>
      }
    />
  );
}
