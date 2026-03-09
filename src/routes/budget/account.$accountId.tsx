import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { AccountHeader } from "@/components/budget/account-header";
import { useBudget } from "@/contexts/budget-context";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES } from "@/lib/mock-data";
import { getTransactionsForAccount } from "@/lib/queries";
import type { Transaction } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/budget/account/$accountId")({
  component: AccountView,
});

function AccountView() {
  const { accountId } = Route.useParams();
  const account = MOCK_ACCOUNTS.find((a) => a.id === accountId);
  const { transactions, setTransactions, editingTxnId, editTransaction, cancelEdit, setCurrentAccountId } = useBudget();

  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

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

  const handleDelete = () => {
    if (!deletingTxn) return;
    setTransactions((prev) => {
      if (deletingTxn.type === "transfer" && deletingTxn.transferPairId) {
        return prev.filter((t) => t.id !== deletingTxn.id && t.id !== deletingTxn.transferPairId);
      }
      return prev.filter((t) => t.id !== deletingTxn.id);
    });
    if (editingTxnId === deletingTxn.id) cancelEdit();
    setDeletingTxn(null);
    toast.success("Transaction deleted");
  };

  return (
    <div>
      <AccountHeader account={account} transactions={transactions} />
      <div className="p-6 space-y-4">
        <TransactionToolbar categories={MOCK_CATEGORIES} />

        <TransactionList
          transactions={accountTransactions}
          allTransactions={transactions}
          accounts={MOCK_ACCOUNTS}
          categories={MOCK_CATEGORIES}
          showAccountColumn={false}
          editingTransactionId={editingTxnId}
          onEdit={editTransaction}
          onDelete={setDeletingTxn}
        />

        <DeleteTransactionDialog
          transaction={deletingTxn}
          allTransactions={transactions}
          accounts={MOCK_ACCOUNTS}
          categories={MOCK_CATEGORIES}
          onConfirm={handleDelete}
          onCancel={() => setDeletingTxn(null)}
        />
      </div>
    </div>
  );
}
