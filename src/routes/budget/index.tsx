import { createFileRoute } from "@tanstack/react-router";
import { TransactionView } from "@/components/budget/transaction-view";
import { useTransactions } from "@/hooks/use-budget-data";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const { data: transactions = [] } = useTransactions();

  return (
    <TransactionView
      transactions={transactions}
      showAccountColumn={true}
      header={
        <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
          <h2 className="text-xl font-bold tracking-tight">All Accounts</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
          </p>
        </div>
      }
    />
  );
}
