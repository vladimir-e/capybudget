import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar, type TransactionFilters } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { useBudgetUI } from "@/contexts/budget-context";
import { useTransactions } from "@/hooks/use-budget-data";
import type { Transaction } from "@/lib/types";

export const Route = createFileRoute("/budget/")({
  component: AllAccountsView,
});

function AllAccountsView() {
  const { data: transactions = [] } = useTransactions();
  const { editingTxnId, editTransaction, deleteTransaction } = useBudgetUI();
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);
  const [filters, setFilters] = useState<TransactionFilters>({
    search: "",
    categoryId: null,
    dateRange: null,
  });

  const handleDelete = () => {
    if (!deletingTxn) return;
    deleteTransaction(deletingTxn);
    setDeletingTxn(null);
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
        <TransactionToolbar filters={filters} onFiltersChange={setFilters} />

        <TransactionList
          transactions={transactions}
          showAccountColumn={true}
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
