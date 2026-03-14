import { useCallback, useState } from "react";
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
import type { Transaction, TransactionFormData } from "@capybudget/core";
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
}: TransactionListProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
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

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-30" strokeWidth={1.5} />
        <p className="text-base font-medium">No transactions yet</p>
        <p className="text-sm mt-1 opacity-70">Transactions will appear here once added.</p>
      </div>
    );
  }

  return (
    <Table className={hasSelection ? "select-none" : ""}>
      <TableHeader>
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
      </TableHeader>
      <TableBody>
        {transactions.map((txn, i) => {
          const account = accountMap.get(txn.accountId);
          const isPanelEditing = txn.id === editingTransactionId;
          const isEditable = !!onInlineSave && txn.type !== "transfer";
          const activeCol = effectiveEditingCell?.txnId === txn.id ? effectiveEditingCell.column : null;

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

          const isSelected = hasSelection && selectedIds.has(txn.id);

          const rowBg = isSelected
            ? "bg-brand-subtle/50"
            : isPanelEditing
              ? "bg-brand-subtle/40 ring-1 ring-brand/20"
              : i % 2 === 0 ? "bg-transparent" : "bg-muted/30";

          const isCellClickable = isEditable || (!!onEdit && txn.type === "transfer");
          const cellClickClass = isCellClickable ? "cursor-pointer" : "";

          return (
            <TableRow
              key={txn.id}
              className={`transition-colors border-border/50 ${rowBg} ${
                isPanelEditing ? "" : "hover:bg-brand-subtle/50"
              }`}
            >
              {hasSelection && (
                <TableCell
                  className="px-3 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(txn.id, e.shiftKey);
                  }}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(txn.id, false)}
                    aria-label={`Select transaction`}
                  />
                </TableCell>
              )}
              <TableCell
                className={`text-muted-foreground text-[13px] ${cellClickClass}`}
                onClick={() => handleCellClick(txn, "date")}
              >
                {activeCol === "date" ? (
                  <InlineEditCell txn={txn} column="date" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
                ) : formatDate(txn.datetime)}
              </TableCell>
              {showAccountColumn && (
                <TableCell
                  className={`font-medium text-[13px] ${cellClickClass}`}
                  onClick={() => handleCellClick(txn, "account")}
                >
                  {activeCol === "account" ? (
                    <InlineEditCell txn={txn} column="account" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
                  ) : account?.name ?? "Unknown"}
                </TableCell>
              )}
              <TableCell
                className={`text-muted-foreground text-[13px] ${cellClickClass}`}
                onClick={() => handleCellClick(txn, "merchant")}
              >
                {activeCol === "merchant" ? (
                  <InlineEditCell txn={txn} column="merchant" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
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
                onClick={() => handleCellClick(txn, "category")}
              >
                {activeCol === "category" ? (
                  <InlineEditCell txn={txn} column="category" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
                ) : categoryDisplay}
              </TableCell>
              <TableCell
                className={`text-right tabular-nums font-semibold text-[13px] ${getAmountClass(txn)} ${cellClickClass}`}
                onClick={() => handleCellClick(txn, "amount")}
              >
                {activeCol === "amount" ? (
                  <InlineEditCell txn={txn} column="amount" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
