import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { useBudget } from "@/contexts/budget-context";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES } from "@/lib/mock-data";
import type { Transaction } from "@/lib/types";
import { toast } from "sonner";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const { transactions, setTransactions, editingTxnId, editTransaction, cancelEdit } = useBudget();
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

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
      <div className="px-6 py-5 border-b bg-gradient-to-b from-brand-subtle/40 to-transparent">
        <h2 className="text-xl font-bold tracking-tight">All Accounts</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="p-6 space-y-4">
        <TransactionToolbar categories={MOCK_CATEGORIES} />

        <TransactionList
          transactions={transactions}
          allTransactions={transactions}
          accounts={MOCK_ACCOUNTS}
          categories={MOCK_CATEGORIES}
          showAccountColumn={true}
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
