import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar, type TransactionFilters } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { AccountHeader } from "@/components/budget/account-header";
import { useBudget } from "@/contexts/budget-context";
import { getTransactionsForAccount, getAccountBalance } from "@/lib/queries";
import type { Transaction } from "@/lib/types";

export const Route = createFileRoute("/budget/account/$accountId")({
  component: AccountView,
});

function AccountView() {
  const { accountId } = Route.useParams();
  const { accounts, transactions, editingTxnId, editTransaction, deleteTransaction, setCurrentAccountId } = useBudget();
  const account = accounts.find((a) => a.id === accountId);

  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);
  const [filters, setFilters] = useState<TransactionFilters>({
    search: "",
    categoryId: null,
    dateRange: null,
  });

  // Tell the layout which account we're on (for the global form)
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

  const handleDelete = () => {
    if (!deletingTxn) return;
    deleteTransaction(deletingTxn);
    setDeletingTxn(null);
  };

  return (
    <div>
      <AccountHeader account={account} balance={balance} />
      <div className="p-6 space-y-4">
        <TransactionToolbar filters={filters} onFiltersChange={setFilters} />

        <TransactionList
          transactions={accountTransactions}
          showAccountColumn={false}
          editingTransactionId={editingTxnId}
          onEdit={editTransaction}
          onDelete={setDeletingTxn}
        />

        <DeleteTransactionDialog
          transaction={deletingTxn}
          onConfirm={handleDelete}
          onCancel={() => setDeletingTxn(null)}
        />
      </div>
    </div>
  );
}
