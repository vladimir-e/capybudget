import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold tracking-tight">All Accounts</h2>
      </div>
      <TransactionToolbar categories={MOCK_CATEGORIES} />
      <div className="mt-4">
        <TransactionList
          transactions={MOCK_TRANSACTIONS}
          allTransactions={MOCK_TRANSACTIONS}
          accounts={MOCK_ACCOUNTS}
          categories={MOCK_CATEGORIES}
          showAccountColumn={true}
        />
      </div>
    </div>
  );
}
