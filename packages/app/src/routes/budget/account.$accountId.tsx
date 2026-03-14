import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionView } from "@/components/budget/transaction-view";
import { AccountHeader } from "@/components/budget/account-header";
import { useBudgetUI } from "@/contexts/budget-context";
import { useAccounts, useTransactions } from "@/hooks/use-budget-data";
import { getTransactionsForAccount, getAccountBalance } from "@capybudget/core";

export const Route = createFileRoute("/budget/account/$accountId")({
  component: AccountView,
});

function AccountView() {
  const { accountId } = Route.useParams();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { setCurrentAccountId } = useBudgetUI();
  const account = accounts.find((a) => a.id === accountId);

  useEffect(() => {
    setCurrentAccountId(accountId);
    return () => setCurrentAccountId(undefined);
  }, [accountId, setCurrentAccountId]);

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Account not found</p>
      </div>
    );
  }

  const accountTransactions = getTransactionsForAccount(accountId, transactions);
  const balance = getAccountBalance(accountId, transactions);

  return (
    <TransactionView
      transactions={accountTransactions}
      showAccountColumn={false}
      readOnly={account.archived}
      header={<AccountHeader account={account} balance={balance} />}
    />
  );
}
