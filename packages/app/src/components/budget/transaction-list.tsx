import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InlineEditCell, type EditableColumn } from "@/components/budget/inline-edit-cells";
import type { Account, Category, Transaction, TransactionFormData } from "@capybudget/core";
import { formatMoney, getAmountClass, resolveTransferPair } from "@capybudget/core";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import type { SortColumn, SortConfig } from "@/lib/filter-transactions";
import {
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Inbox,
  Info,
  MoreHorizontal,
  Pencil,
  Trash2,
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const datePart = iso.slice(0, 10);
  return new Date(datePart + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function defaultDirection(column: SortColumn): SortConfig["direction"] {
  return column === "date" ? "desc" : "asc";
}

/** Row count threshold: below this, render directly; above, virtualize. */
const VIRTUALIZE_THRESHOLD = 100;
const ROW_HEIGHT_ESTIMATE = 41;

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
// TransactionRow (memoized)
// ---------------------------------------------------------------------------

interface TransactionRowProps {
  txn: Transaction;
  index: number;
  showAccountColumn: boolean;
  accountMap: Map<string, Account>;
  categoryMap: Map<string, Category>;
  allTransactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  isPanelEditing: boolean;
  isEditable: boolean;
  activeCol: EditableColumn | null;
  isSelected: boolean;
  hasSelection: boolean;
  hasActions: boolean;
  onToggleSelect?: (txnId: string, shiftKey: boolean) => void;
  onCellClick: (txn: Transaction, column: EditableColumn) => void;
  onInlineSave: (data: TransactionFormData) => void;
  onInlineCancel: () => void;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

const TransactionRowMemo = memo(function TransactionRow({
  txn,
  index,
  showAccountColumn,
  accountMap,
  categoryMap,
  allTransactions,
  accounts,
  categories,
  isPanelEditing,
  isEditable,
  activeCol,
  isSelected,
  hasSelection,
  hasActions,
  onToggleSelect,
  onCellClick,
  onInlineSave,
  onInlineCancel,
  onEdit,
  onDelete,
}: TransactionRowProps) {
  const account = accountMap.get(txn.accountId);

  // Transfer display
  let categoryDisplay: React.ReactNode;
  if (txn.type === "transfer") {
    const { fromAccountId, toAccountId } = resolveTransferPair(txn, allTransactions);
    const fromName = accountMap.get(fromAccountId)?.name;
    const toName = accountMap.get(toAccountId)?.name;
    categoryDisplay = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span>{fromName ?? "?"}</span>
        <ArrowRight className="h-3 w-3 opacity-50" />
        <span>{toName ?? "?"}</span>
      </span>
    );
  } else if (txn.categoryId) {
    categoryDisplay = categoryMap.get(txn.categoryId)?.name ?? (
      <span className="text-muted-foreground/50 italic">Uncategorized</span>
    );
  } else {
    categoryDisplay = <span className="text-muted-foreground/50 italic">Uncategorized</span>;
  }

  const isCellClickable = isEditable || (!!onEdit && txn.type === "transfer");
  const cellClickClass = isCellClickable ? "cursor-pointer" : "";

  // Returns a fragment of <TableCell> elements — the caller provides the <tr>.
  return (
    <>
      {hasSelection && (
        <TableCell
          className="px-3 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect?.(txn.id, e.shiftKey);
          }}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect?.(txn.id, false)}
            aria-label={`Select transaction`}
          />
        </TableCell>
      )}
      <TableCell
        className={`text-muted-foreground text-[13px] ${cellClickClass}`}
        onClick={() => onCellClick(txn, "date")}
      >
        {activeCol === "date" ? (
          <InlineEditCell txn={txn} column="date" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : formatDate(txn.datetime)}
      </TableCell>
      {showAccountColumn && (
        <TableCell
          className={`font-medium text-[13px] ${cellClickClass}`}
          onClick={() => onCellClick(txn, "account")}
        >
          {activeCol === "account" ? (
            <InlineEditCell txn={txn} column="account" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
          ) : account?.name ?? "Unknown"}
        </TableCell>
      )}
      <TableCell
        className={`text-muted-foreground text-[13px] ${cellClickClass}`}
        onClick={() => onCellClick(txn, "merchant")}
      >
        {activeCol === "merchant" ? (
          <InlineEditCell txn={txn} column="merchant" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : (
          <div className="flex items-center">
            <span className="truncate">
              {txn.type === "transfer" ? (
                <span className="text-muted-foreground/50">Transfer</span>
              ) : txn.merchant}
            </span>
            {txn.note && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="ml-auto pl-2 inline-flex shrink-0 cursor-pointer p-1.5 -m-1.5"
                      onClick={(e) => { e.stopPropagation(); onEdit?.(txn); }}
                      aria-label="Edit transaction note"
                    />
                  }
                >
                  <Info className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
                </TooltipTrigger>
                <TooltipContent>{txn.note}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </TableCell>
      <TableCell
        className={`text-[13px] ${cellClickClass}`}
        onClick={() => onCellClick(txn, "category")}
      >
        {activeCol === "category" ? (
          <InlineEditCell txn={txn} column="category" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : categoryDisplay}
      </TableCell>
      <TableCell
        className={`text-right tabular-nums font-semibold text-[13px] ${getAmountClass(txn)} ${cellClickClass}`}
        onClick={() => onCellClick(txn, "amount")}
      >
        {activeCol === "amount" ? (
          <InlineEditCell txn={txn} column="amount" accounts={accounts} categories={categories} onSave={onInlineSave} onCancel={onInlineCancel} />
        ) : formatMoney(txn.amount)}
      </TableCell>
      {hasActions && (
        <TableCell className="px-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground/50 hover:text-foreground" />
              }
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(txn)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(txn)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </>
  );
});

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
}: TransactionListProps) {
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
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-30" strokeWidth={1.5} />
        <p className="text-base font-medium">No transactions yet</p>
        <p className="text-sm mt-1 opacity-70">Transactions will appear here once added.</p>
      </div>
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
    const { isPanelEditing, isEditable, activeCol, isSelected } = rowProps(txn, i);

    return (
      <TransactionRowMemo
        key={txn.id}
        txn={txn}
        index={i}
        showAccountColumn={showAccountColumn}
        accountMap={accountMap}
        categoryMap={categoryMap}
        allTransactions={allTransactions}
        accounts={accounts}
        categories={categories}
        isPanelEditing={isPanelEditing}
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
            aria-label="Select all transactions"
          />
        </TableHead>
      )}
      <SortableHeader column="date" sort={sort} onSortChange={onSortChange} className="w-[120px]">Date</SortableHeader>
      {showAccountColumn && (
        <SortableHeader column="account" sort={sort} onSortChange={onSortChange}>Account</SortableHeader>
      )}
      <SortableHeader column="merchant" sort={sort} onSortChange={onSortChange}>Merchant</SortableHeader>
      <SortableHeader column="category" sort={sort} onSortChange={onSortChange}>Category</SortableHeader>
      <SortableHeader column="amount" sort={sort} onSortChange={onSortChange} align="right" className="w-[130px]">Amount</SortableHeader>
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
    <div
      ref={scrollContainerRef}
      className="w-full overflow-auto"
      style={{ maxHeight: "calc(100vh - 220px)" }}
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
