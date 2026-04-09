import { useCallback, useEffect, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { MerchantInput } from "@/components/budget/merchant-input";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import type { ImportTransaction, DuplicateMatch } from "@capybudget/core";
import type { Category, Account } from "@capybudget/core";
import {
  formatMoney,
  parseMoney,
  centsToEditString,
  parseLocalDate,
  toDateString,
  formatDateLabel,
} from "@capybudget/core";
import { useTransactions } from "@/hooks/use-budget-data";
import {
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Inbox,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

export type ImportSortColumn =
  | "date"
  | "merchant"
  | "amount"
  | "type"
  | "sourceAccount"
  | "categoryId";

export interface ImportSortConfig {
  column: ImportSortColumn;
  direction: "asc" | "desc";
}

type EditableColumn = "date" | "merchant" | "amount" | "type";

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
  categories: Category[];
  accounts: Account[];
  accountMapping: Record<string, string>;
  duplicates: Map<string, DuplicateMatch>;
}

// ── Helpers ─────────────────────────────────────────────────────

function amountColorClass(txn: ImportTransaction): string {
  if (txn.type === "income") return "text-amount-income";
  if (txn.type === "expense") return "text-amount-expense";
  return "text-muted-foreground";
}

function defaultDirection(column: ImportSortColumn): "asc" | "desc" {
  return column === "date" ? "desc" : "asc";
}

const inputClass =
  "h-7 w-full bg-transparent border-0 border-b border-brand/40 rounded-none px-1 text-[13px] focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors";

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

// ── Inline edit cells ───────────────────────────────────────────

function DateEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (date: string) => void;
  onCancel: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
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
          <span>{formatDateLabel(value)}</span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            required
            selected={parseLocalDate(value)}
            onSelect={(d) => onSave(toDateString(d))}
            onDayKeyDown={(day, _modifiers, e) => {
              if (e.key === "Enter" || e.key === " ") onSave(toDateString(day));
            }}
            defaultMonth={parseLocalDate(value)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MerchantEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const { data: allTransactions = [] } = useTransactions();
  const [draft, setDraft] = useState(value);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <MerchantInput
        value={draft}
        onChange={setDraft}
        onSelect={(merchant) => onSave(merchant)}
        transactions={allTransactions}
        autoFocus
        onBlur={() => onSave(draft.trim() || value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSave(draft.trim() || value); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className={`${inputClass} text-foreground/80`}
        placeholder="Merchant"
      />
    </div>
  );
}

function AmountEdit({
  txn,
  onSave,
  onCancel,
}: {
  txn: ImportTransaction;
  onSave: (cents: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => centsToEditString(txn.amount));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const save = () => {
    const cents = parseMoney(value);
    if (cents >= 0) {
      if (txn.type === "expense") onSave(-cents);
      else if (txn.type === "transfer") onSave(txn.amount < 0 ? -cents : cents);
      else onSave(cents);
    } else {
      onCancel();
    }
  };

  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-end">
      <span className={`text-[13px] font-semibold ${amountColorClass(txn)}`}>
        {txn.amount < 0 ? "-$" : "$"}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className={`${inputClass} text-right tabular-nums font-semibold ${amountColorClass(txn)}`}
        style={{ width: `${Math.max(value.length, 4) + 1}ch` }}
        placeholder="0.00"
      />
    </div>
  );
}

function TypeEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <select
        autoFocus
        value={value}
        onChange={(e) => onSave(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="expense">expense</option>
        <option value="income">income</option>
        <option value="transfer">transfer</option>
      </select>
    </div>
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
  categories,
  accounts,
  accountMapping,
  duplicates,
}: ImportTableProps) {
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    column: EditableColumn;
  } | null>(null);

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

  const handleSave = useCallback(
    (id: string, column: EditableColumn, value: string | number) => {
      const patch: Partial<ImportTransaction> = {};
      if (column === "amount") {
        patch.amount = value as number;
      } else {
        (patch as Record<string, string>)[column] = value as string;
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
        <p className="text-sm mt-1 opacity-70">Try adjusting your search.</p>
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
          <SortableHeader column="date" sort={sort} onSortChange={onSortChange} className="w-[120px]">
            Date
          </SortableHeader>
          <SortableHeader column="merchant" sort={sort} onSortChange={onSortChange}>
            Merchant
          </SortableHeader>
          <SortableHeader column="amount" sort={sort} onSortChange={onSortChange} align="right" className="w-[120px]">
            Amount
          </SortableHeader>
          <SortableHeader column="type" sort={sort} onSortChange={onSortChange} className="w-[90px]">
            Type
          </SortableHeader>
          <SortableHeader column="sourceAccount" sort={sort} onSortChange={onSortChange} className="w-[140px]">
            Account
          </SortableHeader>
          <SortableHeader column="categoryId" sort={sort} onSortChange={onSortChange} className="w-[180px]">
            Category
          </SortableHeader>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((txn, i) => {
          const isSelected = selectedIds.has(txn.id);
          const dup = duplicates.get(txn.id);
          const activeCol =
            editingCell?.rowId === txn.id ? editingCell.column : null;

          const rowBg = dup && !isSelected
            ? "bg-blue-500/5 opacity-60"
            : isSelected
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
                  onToggleSelect(txn.id, e.shiftKey);
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(txn.id, false)}
                    aria-label="Include transaction"
                  />
                  {dup && (
                    <span title={`Possible duplicate (${dup.confidence} confidence)`}>
                      <Copy
                        className={`h-3 w-3 shrink-0 ${dup.confidence === "high" ? "text-blue-500" : "text-blue-400/60"}`}
                      />
                    </span>
                  )}
                </div>
              </TableCell>

              {/* Date */}
              <TableCell
                className="text-muted-foreground text-[13px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "date")}
              >
                {activeCol === "date" ? (
                  <DateEdit
                    value={txn.date}
                    onSave={(d) => handleSave(txn.id, "date", d)}
                    onCancel={handleCancel}
                  />
                ) : (
                  formatDateLabel(txn.date)
                )}
              </TableCell>

              {/* Merchant */}
              <TableCell
                className="text-[13px] max-w-[250px] cursor-pointer"
                onClick={() => handleCellClick(txn.id, "merchant")}
              >
                {activeCol === "merchant" ? (
                  <MerchantEdit
                    value={txn.merchant || txn.description}
                    onSave={(v) => handleSave(txn.id, "merchant", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <div className="min-w-0">
                    <span className="truncate block">
                      {txn.merchant || txn.description}
                    </span>
                    {txn.merchant && txn.merchant !== txn.description && (
                      <span className="truncate block text-[11px] text-muted-foreground/50">
                        {txn.description}
                      </span>
                    )}
                  </div>
                )}
              </TableCell>

              {/* Amount */}
              <TableCell
                className={`text-right tabular-nums font-semibold text-[13px] ${amountColorClass(txn)} cursor-pointer`}
                onClick={() => handleCellClick(txn.id, "amount")}
              >
                {activeCol === "amount" ? (
                  <AmountEdit
                    txn={txn}
                    onSave={(cents) => handleSave(txn.id, "amount", cents)}
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
                  <TypeEdit
                    value={txn.type}
                    onSave={(v) => handleSave(txn.id, "type", v)}
                    onCancel={handleCancel}
                  />
                ) : (
                  <TypeBadge type={txn.type} />
                )}
              </TableCell>

              {/* Account — selector for transfers, display for others */}
              <TableCell className="text-[13px] text-muted-foreground py-1" onClick={(e) => e.stopPropagation()}>
                {txn.type === "transfer" ? (
                  <div className="[&>div]:w-full [&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
                    <AccountSelector
                      accounts={accounts}
                      value={txn.targetAccountId || ""}
                      onChange={(id) =>
                        onUpdateTransaction(txn.id, { targetAccountId: id })
                      }
                      placeholder={txn.amount < 0 ? "To account" : "From account"}
                      includeUnset={!!txn.targetAccountId}
                      disableIds={[accountMapping[txn.sourceAccount] || txn.accountId].filter(Boolean)}
                    />
                  </div>
                ) : (
                  <span className="truncate block">
                    {txn.sourceAccount || <span className="text-muted-foreground/40 italic">none</span>}
                  </span>
                )}
              </TableCell>

              {/* Category (selector) */}
              <TableCell className="text-[13px] py-1" onClick={(e) => e.stopPropagation()}>
                <CategorySelector
                  categories={categories}
                  value={txn.categoryId || null}
                  onChange={(categoryId) =>
                    onUpdateTransaction(txn.id, {
                      categoryId: categoryId || "",
                      categoryConfidence: categoryId ? "high" : "",
                    })
                  }
                  placeholder={txn.type === "transfer" ? "Transfer" : "Uncategorized"}
                  includeUncategorized
                  suffix={txn.categoryConfidence ? (
                    <ConfidenceDot confidence={txn.categoryConfidence} />
                  ) : undefined}
                />
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

// ── Confidence Dot ───────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color =
    confidence === "high"
      ? "bg-amount-income"
      : "bg-amber-400";
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`}
      title={`${confidence} confidence`}
    />
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
      case "merchant":
        cmp = (a.merchant || a.description).localeCompare(b.merchant || b.description);
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
      case "categoryId":
        cmp = a.categoryId.localeCompare(b.categoryId);
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
      (t.merchant && t.merchant.toLowerCase().includes(q)) ||
      t.sourceAccount.toLowerCase().includes(q) ||
      t.sourceCategory.toLowerCase().includes(q) ||
      t.memo.toLowerCase().includes(q) ||
      t.type.includes(q) ||
      formatMoney(t.amount).toLowerCase().includes(q),
  );
}
