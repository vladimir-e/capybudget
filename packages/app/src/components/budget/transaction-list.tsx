import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { type EditableColumn } from "@/components/budget/inline-edit-cells";
import type { Transaction, TransactionFormData } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import type { SortColumn, SortConfig } from "@/lib/filter-transactions";
import { TransactionRowMemo } from "@/components/budget/transaction-row";
import {
  defaultDirection,
  ROW_HEIGHT_ESTIMATE,
  VIRTUALIZE_THRESHOLD,
} from "@/components/budget/transaction-list-utils";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Inbox,
} from "lucide-react";

interface TransactionListProps {
  transactions: Transaction[];
  showAccountColumn: boolean;
  editingTransactionId?: string | null;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
  onInlineSave?: (data: TransactionFormData) => void;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  /** Selection state — omit to hide checkboxes. */
  selectedIds?: Set<string>;
  onToggleSelect?: (txnId: string, shiftKey: boolean) => void;
  onToggleAll?: () => void;
  allSelected?: boolean;
  indeterminate?: boolean;
  /** Rendered when there are no rows. Defaults to the plain "No transactions yet" state. */
  emptyState?: ReactNode;
}

// ---------------------------------------------------------------------------
// SortableHeader
// ---------------------------------------------------------------------------

function SortableHeader({
  column,
  sort,
  onSortChange,
  align = "left",
  className,
  children,
}: {
  column: SortColumn;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sort.column === column;

  const handleClick = () => {
    if (isActive) {
      onSortChange({ column, direction: sort.direction === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ column, direction: defaultDirection(column) });
    }
  };

  const Icon = isActive
    ? sort.direction === "asc" ? ChevronUp : ChevronDown
    : ArrowUpDown;

  return (
    <TableHead className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={handleClick}
        className={`group inline-flex items-center gap-1 cursor-pointer select-none text-xs font-semibold uppercase tracking-wider ${
          isActive ? "text-foreground" : "text-muted-foreground/70"
        } ${align === "right" ? "ml-auto" : ""}`}
      >
        {children}
        <Icon
          className={`h-3 w-3 shrink-0 ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50"
          } transition-opacity`}
        />
      </button>
    </TableHead>
  );
}

// ---------------------------------------------------------------------------
// TransactionList
// ---------------------------------------------------------------------------

export function TransactionList({
  transactions,
  showAccountColumn,
  editingTransactionId,
  onEdit,
  onDelete,
  onInlineSave,
  sort,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected,
  indeterminate,
  emptyState,
}: TransactionListProps) {
  const { t } = useTranslation("budget");
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const hasActions = !!(onEdit || onDelete || onInlineSave);
  const hasSelection = !!(selectedIds && onToggleSelect);

  const [editingCell, setEditingCell] = useState<{ txnId: string; column: EditableColumn } | null>(null);

  // If the panel form opens for the same txn, cancel inline edit
  const effectiveEditingCell =
    editingTransactionId && editingCell?.txnId === editingTransactionId
      ? null
      : editingCell;

  const handleCellClick = useCallback(
    (txn: Transaction, column: EditableColumn) => {
      if (!onInlineSave) return;
      if (txn.type === "transfer") {
        onEdit?.(txn);
        return;
      }
      // Prevent re-entry if this cell is already being edited
      setEditingCell((prev) =>
        prev?.txnId === txn.id && prev?.column === column ? prev : { txnId: txn.id, column },
      );
    },
    [onInlineSave, onEdit],
  );

  const handleInlineSave = useCallback(
    (data: TransactionFormData) => {
      onInlineSave?.(data);
      setEditingCell(null);
    },
    [onInlineSave],
  );

  const handleInlineCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  const shouldVirtualize = transactions.length >= VIRTUALIZE_THRESHOLD;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 20,
    enabled: shouldVirtualize,
  });

  if (transactions.length === 0) {
    return (
      emptyState ?? (
        <EmptyState
          className="py-24"
          icon={<Inbox strokeWidth={1.5} />}
          title={t("transaction.list.emptyTitle")}
          description={t("transaction.list.emptyDescription")}
        />
      )
    );
  }

  function rowProps(txn: Transaction, i: number) {
    const isPanelEditing = txn.id === editingTransactionId;
    const isEditable = !!onInlineSave && txn.type !== "transfer";
    const activeCol = effectiveEditingCell?.txnId === txn.id ? effectiveEditingCell.column : null;
    const isSelected = hasSelection && selectedIds!.has(txn.id);

    const rowBg = isSelected
      ? "bg-brand-subtle/50"
      : isPanelEditing
        ? "bg-brand-subtle/40 ring-1 ring-brand/20"
        : i % 2 === 0 ? "bg-transparent" : "bg-muted/30";

    const rowClassName = `transition-colors border-border/50 ${rowBg} ${
      isPanelEditing ? "" : "hover:bg-brand-subtle/50"
    }`;

    return { isPanelEditing, isEditable, activeCol, isSelected, rowClassName };
  }

  function renderCells(txn: Transaction, i: number) {
    const { isEditable, activeCol, isSelected } = rowProps(txn, i);

    return (
      <TransactionRowMemo
        key={txn.id}
        txn={txn}
        showAccountColumn={showAccountColumn}
        accountMap={accountMap}
        categoryMap={categoryMap}
        allTransactions={allTransactions}
        accounts={accounts}
        categories={categories}
        isEditable={isEditable}
        activeCol={activeCol}
        isSelected={isSelected}
        hasSelection={hasSelection}
        hasActions={hasActions}
        onToggleSelect={onToggleSelect}
        onCellClick={handleCellClick}
        onInlineSave={handleInlineSave}
        onInlineCancel={handleInlineCancel}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  }

  const tableHeader = (
    <TableRow className="hover:bg-transparent border-b-2 border-border">
      {hasSelection && (
        <TableHead className="w-[40px] px-3">
          <Checkbox
            checked={allSelected}
            indeterminate={indeterminate}
            onCheckedChange={() => onToggleAll?.()}
            aria-label={t("transaction.list.selectAll")}
          />
        </TableHead>
      )}
      <SortableHeader column="date" sort={sort} onSortChange={onSortChange} className="w-[120px]">{t("transaction.list.date")}</SortableHeader>
      {showAccountColumn && (
        <SortableHeader column="account" sort={sort} onSortChange={onSortChange}>{t("transaction.list.account")}</SortableHeader>
      )}
      <SortableHeader column="merchant" sort={sort} onSortChange={onSortChange} className="max-w-[300px]">{t("transaction.list.merchant")}</SortableHeader>
      <SortableHeader column="category" sort={sort} onSortChange={onSortChange}>{t("transaction.list.category")}</SortableHeader>
      <SortableHeader column="amount" sort={sort} onSortChange={onSortChange} align="right" className="w-[130px]">{t("transaction.list.amount")}</SortableHeader>
      {hasActions && <TableHead className="w-[48px]" />}
    </TableRow>
  );

  // For small lists, render directly without virtualization
  if (!shouldVirtualize) {
    return (
      <Table className={hasSelection ? "select-none" : ""}>
        <TableHeader>
          {tableHeader}
        </TableHeader>
        <TableBody>
          {transactions.map((txn, i) => {
            const { rowClassName } = rowProps(txn, i);
            return (
              <TableRow key={txn.id} className={rowClassName}>
                {renderCells(txn, i)}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  // Virtualized rendering — use spacer rows instead of absolute positioning
  // because CSS position:absolute is undefined on table-row elements.
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    // Fill the parent and own the vertical scroll. Callers (the account view,
    // the drilldown modal) hand this a bounded flex height, so the list scrolls
    // internally while the surrounding chrome stays put — no viewport-math
    // height cap to mis-budget and no second scroller in the ancestor chain.
    <div
      ref={scrollContainerRef}
      className="list-scroll h-full w-full overflow-auto"
    >
      <table
        data-slot="table"
        className={`w-full caption-bottom text-sm ${hasSelection ? "select-none" : ""}`}
      >
        <thead
          data-slot="table-header"
          className="[&_tr]:border-b sticky top-0 z-10 bg-background"
        >
          {tableHeader}
        </thead>
        <TableBody>
          {paddingTop > 0 && (
            <tr style={{ height: paddingTop }} />
          )}
          {virtualItems.map((virtualRow) => {
            const txn = transactions[virtualRow.index];
            const { rowClassName } = rowProps(txn, virtualRow.index);
            return (
              <tr
                key={txn.id}
                data-slot="table-row"
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={`border-b ${rowClassName}`}
              >
                {renderCells(txn, virtualRow.index)}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr style={{ height: paddingBottom }} />
          )}
        </TableBody>
      </table>
    </div>
  );
}
