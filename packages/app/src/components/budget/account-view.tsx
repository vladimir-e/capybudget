import { useEffect } from "react";
import { TransactionView } from "@/components/budget/transaction-view";
import { AccountHeader } from "@/components/budget/account-header";
import { useBudgetUI } from "@/contexts/budget-context";
import { useBudgetLabels } from "@/lib/use-budget-labels";
import { useAccounts, useTransactions } from "@/hooks/use-budget-data";
import { useConverter } from "@/contexts/currency-context";
import { getTransactionsForAccount, getAccountBalance } from "@capybudget/core";

export function AccountView({ accountId }: { accountId: string }) {
  const labels = useBudgetLabels();
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
  // The account page is the account's own view, so the header leads with the
  // native balance in the account's currency. The converter values it in the
  // default for the secondary line a foreign account shows.
  const nativeBalance = getAccountBalance(accountId, transactions);
  const defaultBalance = getAccountBalance(accountId, transactions, converter, account.currency);

  return (
    <TransactionView
      transactions={accountTransactions}
      showAccountColumn={false}
      readOnly={account.archived}
      header={
        <AccountHeader
          account={account}
          nativeBalance={nativeBalance}
          defaultBalance={defaultBalance}
        />
      }
    />
  );
}
