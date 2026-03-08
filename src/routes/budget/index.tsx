import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  return (
    <div className="p-6">
      <h2 className="text-lg font-bold tracking-tight mb-4">All Accounts</h2>
      <TransactionList
        transactions={MOCK_TRANSACTIONS}
        allTransactions={MOCK_TRANSACTIONS}
        accounts={MOCK_ACCOUNTS}
        categories={MOCK_CATEGORIES}
        showAccountColumn={true}
      />
    </div>
  );
}
