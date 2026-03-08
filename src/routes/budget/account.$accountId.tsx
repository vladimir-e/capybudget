import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { AccountHeader } from "@/components/budget/account-header";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { getTransactionsForAccount } from "@/lib/queries";

export const Route = createFileRoute("/budget/account/$accountId")({
  component: AccountView,
});

function AccountView() {
  const { accountId } = Route.useParams();
  const account = MOCK_ACCOUNTS.find((a) => a.id === accountId);

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Account not found</p>
      </div>
    );
  }

  const transactions = getTransactionsForAccount(accountId, MOCK_TRANSACTIONS);

  return (
    <div>
      <AccountHeader account={account} transactions={MOCK_TRANSACTIONS} />
      <div className="p-6">
        <TransactionList
          transactions={transactions}
          allTransactions={MOCK_TRANSACTIONS}
          accounts={MOCK_ACCOUNTS}
          categories={MOCK_CATEGORIES}
          showAccountColumn={false}
        />
      </div>
    </div>
  );
}
