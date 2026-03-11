import { useCallback, useEffect, useRef, useState } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { AccountSelector } from "@/components/budget/account-selector";
import { CategorySelector } from "@/components/budget/category-selector";
import { formatMoney, parseMoney } from "@/lib/money";
import { parseLocalDate, toDateString, formatDateLabel } from "@/lib/date-utils";
import { resolveTransferPair } from "@/lib/queries";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import type { Transaction } from "@/lib/types";
import type { TransactionFormData } from "@/services/transactions";
import type { SortColumn, SortConfig } from "@/lib/filter-transactions";
import {
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Inbox,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditableColumn = "date" | "account" | "category" | "merchant" | "amount";

interface TransactionListProps {
  transactions: Transaction[];
  showAccountColumn: boolean;
  editingTransactionId?: string | null;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
  onInlineSave?: (data: TransactionFormData) => void;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
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

function getAmountClass(txn: Transaction): string {
  if (txn.type === "transfer") return "text-amount-transfer";
  if (txn.amount < 0) return "text-amount-expense";
  return "text-amount-income";
}

function defaultDirection(column: SortColumn): SortConfig["direction"] {
  return column === "date" ? "desc" : "asc";
}

/** Format cents as an unsigned dollar string for editing: 1250 → "12.50" */
function centsToEditString(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
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
// InlineEditCell — renders a single editable cell, saves on Enter/blur
// ---------------------------------------------------------------------------

function InlineEditCell({
  txn,
  column,
  accounts,
  categories,
  onSave,
  onCancel,
}: {
  txn: Transaction;
  column: EditableColumn;
  accounts: import("@/lib/types").Account[];
  categories: import("@/lib/types").Category[];
  onSave: (data: TransactionFormData) => void;
  onCancel: () => void;
}) {
  const buildFormData = useCallback(
    (patch: Partial<{ date: string; accountId: string; categoryId: string; merchant: string; amount: number }>) => {
      const data: TransactionFormData = {
        id: txn.id,
        type: txn.type,
        amount: Math.abs(txn.amount),
        categoryId: txn.categoryId,
        accountId: txn.accountId,
        date: txn.datetime.slice(0, 10),
        merchant: txn.merchant,
        note: txn.note,
        ...patch,
      };
      onSave(data);
    },
    [txn, onSave],
  );

  const inputClass =
    "h-7 w-full bg-transparent border-0 border-b border-brand/40 rounded-none px-1 text-[13px] focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors";

  if (column === "date") {
    return <DateEditCell txn={txn} onSave={(date) => buildFormData({ date })} onCancel={onCancel} />;
  }
  if (column === "account") {
    return <AccountEditCell txn={txn} accounts={accounts} onSave={(accountId) => buildFormData({ accountId })} onCancel={onCancel} />;
  }
  if (column === "category") {
    return <CategoryEditCell txn={txn} categories={categories} onSave={(categoryId) => buildFormData({ categoryId })} onCancel={onCancel} />;
  }
  if (column === "merchant") {
    return <MerchantEditCell txn={txn} inputClass={inputClass} onSave={(merchant) => buildFormData({ merchant })} onCancel={onCancel} />;
  }
  // amount
  return <AmountEditCell txn={txn} inputClass={inputClass} onSave={(amount) => buildFormData({ amount })} onCancel={onCancel} />;
}

function DateEditCell({ txn, onSave, onCancel }: {
  txn: Transaction;
  onSave: (date: string) => void; onCancel: () => void;
}) {
  const currentDate = txn.datetime.slice(0, 10);

  return (
    <Popover defaultOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
          />
        }
      >
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span>{formatDateLabel(currentDate)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          required
          selected={parseLocalDate(currentDate)}
          onSelect={(d) => onSave(toDateString(d))}
          onDayKeyDown={(day, _modifiers, e) => {
            if (e.key === "Enter" || e.key === " ") onSave(toDateString(day));
          }}
          defaultMonth={parseLocalDate(currentDate)}
        />
      </PopoverContent>
    </Popover>
  );
}

function AccountEditCell({ txn, accounts, onSave, onCancel }: {
  txn: Transaction; accounts: import("@/lib/types").Account[];
  onSave: (accountId: string) => void; onCancel: () => void;
}) {
  const saved = useRef(false);
  return (
    <AccountSelector
      accounts={accounts}
      value={txn.accountId}
      defaultOpen
      onChange={(id) => { saved.current = true; onSave(id); }}
      onOpenChange={(open) => { if (!open && !saved.current) onCancel(); }}
    />
  );
}

function CategoryEditCell({ txn, categories, onSave, onCancel }: {
  txn: Transaction; categories: import("@/lib/types").Category[];
  onSave: (categoryId: string) => void; onCancel: () => void;
}) {
  const saved = useRef(false);
  return (
    <CategorySelector
      categories={categories}
      value={txn.categoryId || null}
      defaultOpen
      onChange={(id) => { saved.current = true; onSave(id ?? ""); }}
      onOpenChange={(open) => { if (!open && !saved.current) onCancel(); }}
      placeholder="Uncategorized"
      includeUncategorized
    />
  );
}

function MerchantEditCell({ txn, inputClass, onSave, onCancel }: {
  txn: Transaction; inputClass: string;
  onSave: (merchant: string) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(txn.merchant);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onSave(value.trim())}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(value.trim()); } if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
      className={`${inputClass} text-muted-foreground`}
      placeholder="Merchant"
    />
  );
}

function AmountEditCell({ txn, inputClass, onSave, onCancel }: {
  txn: Transaction; inputClass: string;
  onSave: (amount: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(() => centsToEditString(txn.amount));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const save = () => { const cents = parseMoney(value); if (cents > 0) onSave(cents); else onCancel(); };

  return (
    <div className="flex items-center justify-end gap-0.5">
      <span className={`text-[13px] font-semibold shrink-0 ${getAmountClass(txn)}`}>
        {txn.amount < 0 ? "-$" : "$"}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); onCancel(); } }}
        className={`${inputClass} text-right tabular-nums font-semibold w-[90px] ${getAmountClass(txn)}`}
        placeholder="0.00"
      />
    </div>
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
}: TransactionListProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const hasActions = !!(onEdit || onDelete || onInlineSave);

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
      setEditingCell({ txnId: txn.id, column });
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
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent border-b-2 border-border">
          <SortableHeader column="date" sort={sort} onSortChange={onSortChange} className="w-[120px]">Date</SortableHeader>
          {showAccountColumn && (
            <SortableHeader column="account" sort={sort} onSortChange={onSortChange}>Account</SortableHeader>
          )}
          <SortableHeader column="category" sort={sort} onSortChange={onSortChange}>Category</SortableHeader>
          <SortableHeader column="merchant" sort={sort} onSortChange={onSortChange}>Merchant</SortableHeader>
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

          const rowBg = isPanelEditing
            ? "bg-brand-subtle/40 ring-1 ring-brand/20"
            : i % 2 === 0 ? "bg-transparent" : "bg-muted/30";

          const cellClickClass = isEditable ? "cursor-pointer" : "";

          return (
            <TableRow
              key={txn.id}
              className={`transition-colors border-border/50 ${rowBg} ${
                isPanelEditing ? "" : "hover:bg-brand-subtle/50"
              }`}
            >
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
                className={`text-[13px] ${cellClickClass}`}
                onClick={() => handleCellClick(txn, "category")}
              >
                {activeCol === "category" ? (
                  <InlineEditCell txn={txn} column="category" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
                ) : categoryDisplay}
              </TableCell>
              <TableCell
                className={`text-muted-foreground text-[13px] ${cellClickClass}`}
                onClick={() => handleCellClick(txn, "merchant")}
              >
                {activeCol === "merchant" ? (
                  <InlineEditCell txn={txn} column="merchant" accounts={accounts} categories={categories} onSave={handleInlineSave} onCancel={handleInlineCancel} />
                ) : txn.type === "transfer" ? (
                  <span className="text-muted-foreground/50">Transfer</span>
                ) : txn.merchant}
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
