import { useCallback, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ImportTransaction } from "@capybudget/core";
import { formatMoney } from "@capybudget/core";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Inbox,
  Trash2,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

export type ImportSortColumn =
  | "date"
  | "description"
  | "amount"
  | "type"
  | "sourceAccount"
  | "sourceCategory";

export interface ImportSortConfig {
  column: ImportSortColumn;
  direction: "asc" | "desc";
}

type EditableColumn = Exclude<ImportSortColumn, never> | "memo";

interface ImportTableProps {
  transactions: ImportTransaction[];
  sort: ImportSortConfig;
  onSortChange: (sort: ImportSortConfig) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onToggleAll: () => void;
  allSelected: boolean;
  indeterminate: boolean;
  onUpdateTransaction: (id: string, patch: Partial<ImportTransaction>) => void;
  onDeleteTransaction: (id: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function amountColorClass(txn: ImportTransaction): string {
  if (txn.type === "income") return "text-amount-income";
  if (txn.type === "expense") return "text-amount-expense";
  return "text-muted-foreground";
}

function defaultDirection(column: ImportSortColumn): "asc" | "desc" {
  return column === "date" ? "desc" : "asc";
}

// ── SortableHeader ──────────────────────────────────────────────

function SortableHeader({
  column,
  sort,
  onSortChange,
  align = "left",
  className,
  children,
}: {
  column: ImportSortColumn;
  sort: ImportSortConfig;
  onSortChange: (sort: ImportSortConfig) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = sort.column === column;

  const handleClick = () => {
    if (isActive) {
      onSortChange({
        column,
        direction: sort.direction === "asc" ? "desc" : "asc",
      });
    } else {
      onSortChange({ column, direction: defaultDirection(column) });
    }
  };

  const Icon = isActive
    ? sort.direction === "asc"
      ? ChevronUp
      : ChevronDown
    : ArrowUpDown;

  return (
    <TableHead
      className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`}
    >
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

// ── Inline Edit Cell ────────────────────────────────────────────

function InlineInput({
  value,
  onCommit,
  onCancel,
  type = "text",
  align,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  type?: "text" | "date";
  align?: "right";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    if (draft !== value) onCommit(draft);
    else onCancel();
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className={`h-7 text-[13px] px-1.5 ${align === "right" ? "text-right" : ""}`}
    />
  );
}

function TypeSelect({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <select
      autoFocus
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      className="h-7 rounded-md border border-input bg-background px-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <option value="expense">expense</option>
      <option value="income">income</option>
      <option value="transfer">transfer</option>
    </select>
  );
}

// ── ImportTable ──────────────────────────────────────────────────

export function ImportTable({
  transactions,
  sort,
  onSortChange,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  allSelected,
  indeterminate,
  onUpdateTransaction,
  onDeleteTransaction,
}: ImportTableProps) {
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    column: EditableColumn;
  } | null>(null);
  const lastToggledRef = useRef<string | null>(null);

  const handleToggle = useCallback(
    (id: string, shiftKey: boolean) => {
      onToggleSelect(id, shiftKey);
      lastToggledRef.current = id;
    },
    [onToggleSelect],
  );

  const handleCellClick = useCallback(
    (rowId: string, column: EditableColumn) => {
      setEditingCell((prev) =>
        prev?.rowId === rowId && prev?.column === column
          ? prev
          : { rowId, column },
      );
    },
    [],
  );

  const handleCommit = useCallback(
    (id: string, column: EditableColumn, value: string) => {
      const patch: Partial<ImportTransaction> = {};
      if (column === "amount") {
        const cents = Math.round(parseFloat(value) * 100);
        if (!isNaN(cents)) patch.amount = cents;
      } else {
        (patch as Record<string, string>)[column] = value;
      }
      onUpdateTransaction(id, patch);
      setEditingCell(null);
    },
    [onUpdateTransaction],
  );

  const handleCancel = useCallback(() => {
    setEditingCell(null);
  }, []);

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <Inbox className="h-12 w-12 mb-3 opacity-30" strokeWidth={1.5} />
        <p className="text-base font-medium">No transactions found</p>
        <p className="text-sm mt-1 opacity-70">
          Try adjusting your search.
        </p>
      </div>
    );
  }

  return (
    <Table className="select-none">
      <TableHeader>
        <TableRow className="hover:bg-transparent border-b-2 border-border">
          <TableHead className="w-[40px] px-3">
            <Checkbox
              checked={allSelected}
              indeterminate={indeterminate}
              onCheckedChange={() => onToggleAll()}
              aria-label="Select all transactions"
            />
          </TableHead>
          <SortableHeader
            column="date"
            sort={sort}
            onSortChange={onSortChange}
            className="w-[110px]"
          >
            Date
          </SortableHeader>
          <SortableHeader
            column="description"
            sort={sort}
            onSortChange={onSortChange}
          >
            Description
          </SortableHeader>
          <SortableHeader
            column="amount"
            sort={sort}
            onSortChange={onSortChange}
            align="right"
            className="w-[120px]"
          >
            Amount
          </SortableHeader>
          <SortableHeader
            column="type"
            sort={sort}
            onSortChange={onSortChange}
            className="w-[100px]"
          >
            Type
          </SortableHeader>
          <SortableHeader
            column="sourceAccount"
            sort={sort}
            onSortChange={onSortChange}
          >
            Account
          </SortableHeader>
          <SortableHeader
            column="sourceCategory"
            sort={sort}
            onSortChange={onSortChange}
          >
            Category
          </SortableHeader>
          <TableHead className="w-[40px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((txn, i) => {
          const isSelected = selectedIds.has(txn.id);
          const activeCol =
            editingCell?.rowId === txn.id ? editingCell.column : null;

          const rowBg = isSelected
            ? i % 2 === 0
              ? "bg-transparent"
              : "bg-muted/30"
            : "bg-muted/10 opacity-50";

          return (
            <TableRow
              key={txn.id}
              className={`transition-colors border-border/50 hover:bg-brand-subtle/30 ${rowBg}`}
            >
              {/* Checkbox */}
              <TableCell
                className="px-3 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(txn.id, e.shiftKey);
                }}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => handleToggle(txn.id, false)}
                  aria-label="Include transaction"
                />
              </TableCell>

              {/* Date */}
              <TableCell
                className="text-muted-foreground text-[13px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "date")}
              >
                {activeCol === "date" ? (
                  <InlineInput
                    value={txn.date}
                    type="date"
                    onCommit={(v) => handleCommit(txn.id, "date", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  formatDate(txn.date)
                )}
              </TableCell>

              {/* Description */}
              <TableCell
                className="text-[13px] max-w-[250px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "description")}
              >
                {activeCol === "description" ? (
                  <InlineInput
                    value={txn.description}
                    onCommit={(v) => handleCommit(txn.id, "description", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <span className="truncate block">{txn.description}</span>
                )}
              </TableCell>

              {/* Amount */}
              <TableCell
                className={`text-right tabular-nums font-semibold text-[13px] ${amountColorClass(txn)} cursor-pointer`}
                onClick={() => handleCellClick(txn.id, "amount")}
              >
                {activeCol === "amount" ? (
                  <InlineInput
                    value={(txn.amount / 100).toFixed(2)}
                    align="right"
                    onCommit={(v) => handleCommit(txn.id, "amount", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  formatMoney(txn.amount)
                )}
              </TableCell>

              {/* Type */}
              <TableCell
                className="text-[13px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "type")}
              >
                {activeCol === "type" ? (
                  <TypeSelect
                    value={txn.type}
                    onCommit={(v) => handleCommit(txn.id, "type", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <TypeBadge type={txn.type} />
                )}
              </TableCell>

              {/* Source Account */}
              <TableCell
                className="text-[13px] text-muted-foreground cursor-pointer"
                onClick={() => handleCellClick(txn.id, "sourceAccount")}
              >
                {activeCol === "sourceAccount" ? (
                  <InlineInput
                    value={txn.sourceAccount}
                    onCommit={(v) =>
                      handleCommit(txn.id, "sourceAccount", v)
                    }
                    onCancel={handleCancel}
                  />
                ) : (
                  <span className="truncate block">
                    {txn.sourceAccount || (
                      <span className="text-muted-foreground/40 italic">
                        none
                      </span>
                    )}
                  </span>
                )}
              </TableCell>

              {/* Source Category */}
              <TableCell
                className="text-[13px] text-muted-foreground cursor-pointer"
                onClick={() => handleCellClick(txn.id, "sourceCategory")}
              >
                {activeCol === "sourceCategory" ? (
                  <InlineInput
                    value={txn.sourceCategory}
                    onCommit={(v) =>
                      handleCommit(txn.id, "sourceCategory", v)
                    }
                    onCancel={handleCancel}
                  />
                ) : (
                  <span className="truncate block">
                    {txn.sourceCategory || (
                      <span className="text-muted-foreground/40 italic">
                        none
                      </span>
                    )}
                  </span>
                )}
              </TableCell>

              {/* Delete */}
              <TableCell className="px-1">
                <button
                  type="button"
                  onClick={() => onDeleteTransaction(txn.id)}
                  className="rounded-md p-1 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label="Delete transaction"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Type Badge ──────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    expense: "bg-amount-expense/10 text-amount-expense",
    income: "bg-amount-income/10 text-amount-income",
    transfer: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${colors[type] ?? colors.transfer}`}
    >
      {type}
    </span>
  );
}

// ── Sort + Filter utilities ─────────────────────────────────────

export function sortImportTransactions(
  transactions: ImportTransaction[],
  sort: ImportSortConfig,
): ImportTransaction[] {
  const sorted = [...transactions];
  const dir = sort.direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "date":
        cmp = a.date.localeCompare(b.date);
        break;
      case "description":
        cmp = a.description.localeCompare(b.description);
        break;
      case "amount":
        cmp = a.amount - b.amount;
        break;
      case "type":
        cmp = a.type.localeCompare(b.type);
        break;
      case "sourceAccount":
        cmp = a.sourceAccount.localeCompare(b.sourceAccount);
        break;
      case "sourceCategory":
        cmp = a.sourceCategory.localeCompare(b.sourceCategory);
        break;
    }
    return cmp * dir;
  });

  return sorted;
}

export function filterImportTransactions(
  transactions: ImportTransaction[],
  search: string,
): ImportTransaction[] {
  if (!search) return transactions;
  const q = search.toLowerCase();
  return transactions.filter(
    (t) =>
      t.description.toLowerCase().includes(q) ||
      t.sourceAccount.toLowerCase().includes(q) ||
      t.sourceCategory.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      t.type.includes(q) ||
      formatMoney(t.amount).toLowerCase().includes(q),
  );
}
