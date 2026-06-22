import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionView } from "@/components/budget/transaction-view";
import { AccountHeader } from "@/components/budget/account-header";
import { useBudgetUI } from "@/contexts/budget-context";
import { useBudgetLabels } from "@/lib/use-budget-labels";
import { useAccounts, useTransactions } from "@/hooks/use-budget-data";
import { useConverter } from "@/contexts/currency-context";
import { getTransactionsForAccount, getAccountBalance } from "@capybudget/core";

export const Route = createFileRoute("/budget/_shell/account/$accountId")({
  component: AccountView,
});

function AccountView() {
  const labels = useBudgetLabels();
  const { accountId } = Route.useParams();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const converter = useConverter();
  const { setCurrentAccountId } = useBudgetUI();
  const account = accounts.find((a) => a.id === accountId);

  useEffect(() => {
    setCurrentAccountId(accountId);
    return () => setCurrentAccountId(undefined);
  }, [accountId, setCurrentAccountId]);

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">{labels.accountNotFound()}</p>
      </div>
    );
  }

  const accountTransactions = getTransactionsForAccount(accountId, transactions);
  const nativeBalance = getAccountBalance(accountId, transactions);
  const defaultBalance = getAccountBalance(accountId, transactions, converter, account.currency);

  return (
    <TransactionView
      transactions={accountTransactions}
      showAccountColumn={false}
      readOnly={account.archived}
      header={<AccountHeader account={account} nativeBalance={nativeBalance} defaultBalance={defaultBalance} />}
    />
  );
}
