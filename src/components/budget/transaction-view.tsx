import { useCallback, useState, type ReactNode } from "react";
import { TransactionList } from "@/components/budget/transaction-list";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { BulkActionBar } from "@/components/budget/bulk-action-bar";
import { useBudgetUI } from "@/contexts/budget-context";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { useUpdateTransaction, useDeleteTransaction } from "@/hooks/use-transaction-mutations";
import { useTransactionFilters } from "@/hooks/use-transaction-filters";
import { useTransactionSelection } from "@/hooks/use-transaction-selection";
import type { Transaction } from "@/lib/types";
import type { TransactionFormData } from "@/services/transactions";
import { toast } from "sonner";

interface TransactionViewProps {
  transactions: Transaction[];
  header: ReactNode;
  showAccountColumn: boolean;
  readOnly?: boolean;
}

export function TransactionView({ transactions, header, showAccountColumn, readOnly }: TransactionViewProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { editingTxnId, editTransaction, cancelEdit } = useBudgetUI();
  const { filters, setFilters, sort, setSort, filtered } = useTransactionFilters(transactions, accounts, categories);
  const selection = useTransactionSelection(filtered);
  const [deletingTxn, setDeletingTxn] = useState<Transaction | null>(null);
  const updateTxn = useUpdateTransaction();
  const deleteTxn = useDeleteTransaction();

  const handleDelete = () => {
    if (!deletingTxn) return;
    deleteTxn.mutate(deletingTxn);
    if (editingTxnId === deletingTxn.id) cancelEdit();
    setDeletingTxn(null);
    toast.success("Transaction deleted");
  };

  const handleInlineSave = useCallback(
    (data: TransactionFormData) => {
      // If the panel form is open for this transaction, close it
      if (editingTxnId === data.id) {
        cancelEdit();
      }
      updateTxn.mutate(data);
      toast.success("Transaction updated");
    },
    [updateTxn, editingTxnId, cancelEdit],
  );

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
          onInlineSave={readOnly ? undefined : handleInlineSave}
          sort={sort}
          onSortChange={setSort}
          selectedIds={readOnly ? undefined : selection.selectedIds}
          onToggleSelect={readOnly ? undefined : selection.toggle}
          onToggleAll={readOnly ? undefined : selection.toggleAll}
          allSelected={selection.allSelected}
          indeterminate={selection.indeterminate}
        />

        {!readOnly && (
          <DeleteTransactionDialog
            transaction={deletingTxn}
            onConfirm={handleDelete}
            onCancel={() => setDeletingTxn(null)}
          />
        )}

        {!readOnly && selection.selectedIds.size > 0 && (
          <BulkActionBar
            selectedIds={selection.selectedIds}
            transactions={filtered}
            onClear={selection.clear}
          />
        )}
      </div>
    </div>
  );
}
