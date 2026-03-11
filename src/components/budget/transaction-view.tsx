import { useState, type ReactNode } from "react";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { useBudgetUI } from "@/contexts/budget-context";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { useTransactionFilters } from "@/hooks/use-transaction-filters";
import type { Transaction } from "@/lib/types";

interface TransactionViewProps {
  transactions: Transaction[];
  header: ReactNode;
  showAccountColumn: boolean;
  readOnly?: boolean;
}

export function TransactionView({ transactions, header, showAccountColumn, readOnly }: TransactionViewProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { editingTxnId, editTransaction, deleteTransaction } = useBudgetUI();
  const { filters, setFilters, sort, setSort, filtered } = useTransactionFilters(transactions, accounts, categories);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);

  const handleDelete = () => {
    if (!deletingTxn) return;
    deleteTransaction(deletingTxn);
    setDeletingTxn(null);
  };

  return (
    <div>
      {header}
      <div className="p-6 space-y-4">
        <TransactionToolbar filters={filters} onFiltersChange={setFilters} />

        <TransactionList
          transactions={filtered}
          showAccountColumn={showAccountColumn}
          editingTransactionId={readOnly ? undefined : editingTxnId}
          onEdit={readOnly ? undefined : editTransaction}
          onDelete={readOnly ? undefined : setDeletingTxn}
          sort={sort}
          onSortChange={setSort}
        />

        {!readOnly && (
          <DeleteTransactionDialog
            transaction={deletingTxn}
            onConfirm={handleDelete}
            onCancel={() => setDeletingTxn(null)}
          />
        )}
      </div>
    </div>
  );
}
