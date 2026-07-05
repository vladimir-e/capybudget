import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TransactionList } from "@/components/budget/transaction-list";
import { VIRTUALIZE_THRESHOLD } from "@/components/budget/transaction-list-utils";
import { TransactionToolbar } from "@/components/budget/transaction-toolbar";
import { DeleteTransactionDialog } from "@/components/budget/delete-transaction-dialog";
import { BulkActionBar } from "@/components/budget/bulk-action-bar";
import { FirstRunGuide } from "@/components/budget/first-run-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { useBudgetUI } from "@/contexts/budget-context";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import { useUpdateTransaction, useDeleteTransaction } from "@/hooks/use-transaction-mutations";
import { useTransactionFilters } from "@/hooks/use-transaction-filters";
import { hasActiveFilters } from "@/lib/filter-transactions";
import { useTransactionSelection } from "@/hooks/use-transaction-selection";
import type { Transaction, TransactionFormData } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { toast } from "@/lib/toast";

interface TransactionViewProps {
  transactions: Transaction[];
  header: ReactNode;
  showAccountColumn: boolean;
  readOnly?: boolean;
}

export function TransactionView({ transactions, header, showAccountColumn, readOnly }: TransactionViewProps) {
  const { t } = useTranslation("budget");
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();
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
    toast.success(t("transaction.toast.deleted"));
  };

  const handleInlineSave = useCallback(
    (data: TransactionFormData) => {
      // If the panel form is open for this transaction, close it
      if (editingTxnId === data.id) {
        cancelEdit();
      }
      updateTxn.mutate(data);
      toast.success(t("transaction.toast.updated"));
    },
    [updateTxn, editingTxnId, cancelEdit, t],
  );

  const isFiltered = hasActiveFilters(filters);

  // First run only: the whole budget is empty and we're on the primary
  // all-accounts view (showAccountColumn). A single empty account while others
  // hold data, or a filter/search that matched nothing, get the plain state.
  const emptyState = useMemo<ReactNode>(() => {
    if (isFiltered) {
      return <EmptyState className="py-24" title={t("transaction.list.noMatchTitle")} description={t("transaction.list.noMatchDescription")} />;
    }
    if (showAccountColumn && allTransactions.length === 0) {
      return <FirstRunGuide />;
    }
    return undefined;
  }, [isFiltered, showAccountColumn, allTransactions.length, t]);

  return (
    // Flex column that fills the pane: the title and toolbar are fixed rows and
    // the list takes whatever height is left and scrolls internally, so the pane
    // itself never scrolls (the title stays put) on any viewport — no hand-tuned
    // height budget to drift. The list area carries the styled gutter only when
    // it owns the scroll; once the list virtualizes it wraps its own scroller
    // (see the modal in transactions-browser for the same gating).
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <TransactionToolbar filters={filters} onFiltersChange={setFilters} />

        <div
          className={`min-h-0 flex-1 ${
            filtered.length < VIRTUALIZE_THRESHOLD ? "list-scroll overflow-auto" : ""
          }`}
        >
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
            emptyState={emptyState}
          />
        </div>

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
