import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CategorySelector } from "@/components/budget/category-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { Account, Category, Transaction, TransactionType } from "@/lib/types";
import { parseMoney } from "@/lib/money";
import { Minus, Plus, ArrowLeftRight, Check, CalendarDays } from "lucide-react";

export interface TransactionFormData {
  id?: string;
  type: TransactionType;
  amount: number; // positive cents
  categoryId: string;
  accountId: string;
  toAccountId?: string;
  date: string;
  merchant: string;
  note: string;
}

interface TransactionFormProps {
  accounts: Account[];
  categories: Category[];
  allTransactions: Transaction[];
  editingTransaction?: Transaction | null;
  /** Lock the account (single-account view). */
  fixedAccountId?: string;
  onSave: (data: TransactionFormData) => void;
  onCancel?: () => void;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parse "YYYY-MM-DD" to a local Date (noon to avoid timezone edge). */
function parseLocalDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

/** Format a Date as "YYYY-MM-DD". */
function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format "YYYY-MM-DD" for display: "Mar 8, 2026". */
function formatDateLabel(s: string): string {
  return parseLocalDate(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TYPES: { value: TransactionType; label: string; icon: typeof Minus }[] = [
  { value: "expense", label: "Expense", icon: Minus },
  { value: "income", label: "Income", icon: Plus },
  { value: "transfer", label: "Transfer", icon: ArrowLeftRight },
];

const TYPE_COLORS: Record<TransactionType, { text: string; pill: string }> = {
  expense: {
    text: "text-amount-expense",
    pill: "bg-amount-expense/15 text-amount-expense",
  },
  income: {
    text: "text-amount-income",
    pill: "bg-amount-income/15 text-amount-income",
  },
  transfer: {
    text: "text-amount-transfer",
    pill: "bg-amount-transfer/20 text-amount-transfer",
  },
};

/**
 * Resolve initial transfer accounts from a transaction and the full list.
 * Returns [fromAccountId, toAccountId].
 */
function resolveTransferAccounts(
  txn: Transaction,
  all: Transaction[],
): [string, string] {
  if (txn.type !== "transfer" || !txn.transferPairId) return [txn.accountId, ""];
  const pair = all.find((t) => t.id === txn.transferPairId);
  if (!pair) return [txn.accountId, ""];
  return txn.amount < 0
    ? [txn.accountId, pair.accountId]
    : [pair.accountId, txn.accountId];
}

/**
 * Transaction form — used for both creating and editing.
 *
 * IMPORTANT: When switching between add/edit mode, change the `key` prop
 * on this component so React remounts it with fresh initial state.
 * e.g. `<TransactionForm key={editingTxn?.id ?? "new"} ... />`
 */
export function TransactionForm({
  accounts,
  categories,
  allTransactions,
  editingTransaction,
  fixedAccountId,
  onSave,
  onCancel,
}: TransactionFormProps) {
  const amountRef = useRef<HTMLInputElement>(null);
  const activeAccounts = accounts.filter((a) => !a.archived);
  const accountMap = new Map(activeAccounts.map((a) => [a.id, a.name]));
  const defaultAccountId = fixedAccountId ?? activeAccounts[0]?.id ?? "";
  const isEditing = !!editingTransaction;

  // Derive initial state from props (works with key-based remounting)
  const [initialFrom, initialTo] = editingTransaction
    ? resolveTransferAccounts(editingTransaction, allTransactions)
    : [defaultAccountId, ""];

  const [amount, setAmount] = useState(() =>
    editingTransaction ? (Math.abs(editingTransaction.amount) / 100).toFixed(2) : "",
  );
  const [type, setType] = useState<TransactionType>(
    editingTransaction?.type ?? "expense",
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    editingTransaction?.categoryId || null,
  );
  const [accountId, setAccountId] = useState(initialFrom);
  const [toAccountId, setToAccountId] = useState(initialTo);
  const [date, setDate] = useState(
    editingTransaction ? editingTransaction.datetime.split("T")[0] : getToday(),
  );
  const [merchant, setMerchant] = useState(editingTransaction?.merchant ?? "");
  const [note, setNote] = useState(editingTransaction?.note ?? "");
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  function resetForm() {
    setAmount("");
    setType("expense");
    setCategoryId(null);
    setAccountId(defaultAccountId);
    setToAccountId("");
    setDate(getToday());
    setMerchant("");
    setNote("");
    setTimeout(() => amountRef.current?.focus(), 0);
  }

  function handleCancel() {
    resetForm();
    onCancel?.();
  }

  function handleSubmit() {
    const cents = parseMoney(amount);
    if (cents <= 0) {
      amountRef.current?.focus();
      return;
    }
    if (type === "transfer" && !toAccountId) return;

    onSave({
      id: editingTransaction?.id,
      type,
      amount: cents,
      categoryId: type === "transfer" ? "" : (categoryId ?? ""),
      accountId: fixedAccountId ?? accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      date,
      merchant: merchant.trim(),
      note: note.trim(),
    });

    resetForm();
  }

  // Amount: allow digits and one decimal with max 2 places
  function handleAmountChange(raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setAmount(cleaned);
  }

  const colors = TYPE_COLORS[type];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          if (isEditing) {
            handleCancel();
          } else {
            resetForm();
          }
        }
      }}
      className="rounded-xl border bg-card/50 p-4 space-y-3"
    >
      {/* Row 1: Amount + Type toggle */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold transition-colors ${colors.text}`}>
            $
          </span>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            onKeyDown={(e) => {
              // "-" or Shift+"-" (which produces "_" on US keyboards)
              if (e.key === "-" || e.key === "_") { e.preventDefault(); setType("expense"); }
              else if (e.key === "+" || e.key === "=") { e.preventDefault(); setType("income"); }
            }}
            placeholder="0.00"
            autoFocus
            className={`h-11 w-full rounded-lg border border-input bg-transparent pl-8 pr-3 text-xl font-semibold tabular-nums outline-none transition-colors placeholder:text-muted-foreground/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 ${colors.text}`}
          />
        </div>

        {/* Type pills — outside tab order */}
        <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
          {TYPES.map(({ value, label, icon: Icon }) => {
            const active = type === value;
            return (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                onClick={() => setType(value)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
                  active ? TYPE_COLORS[value].pill : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </div>

        <span className="hidden lg:inline text-[11px] text-muted-foreground/40 leading-tight">
          <kbd className="px-1 rounded bg-muted text-[10px]">-</kbd>
          {" / "}
          <kbd className="px-1 rounded bg-muted text-[10px]">+</kbd>
          {" to switch"}
        </span>
      </div>

      {/* Row 2: Detail fields */}
      <div className="flex items-end gap-2 flex-wrap">
        {/* Category — hidden for transfers */}
        {type !== "transfer" && (
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Category</Label>
            <CategorySelector
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Uncategorized"
              clearable
            />
          </div>
        )}

        {/* Single account selector (non-transfer, all-accounts view) */}
        {type !== "transfer" && !fixedAccountId && (
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Account</Label>
            <Select value={accountId} onValueChange={(v) => v && setAccountId(v)}>
              <SelectTrigger className="h-8 min-w-[130px]">
                <span className="flex flex-1 items-center text-left truncate">
                  {accountMap.get(accountId) ?? "Select account…"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Transfer: From / To */}
        {type === "transfer" && (
          <>
            {!fixedAccountId && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">From</Label>
                <Select value={accountId} onValueChange={(v) => v && setAccountId(v)}>
                  <SelectTrigger className="h-8 min-w-[130px]">
                    <span className="flex flex-1 items-center text-left truncate">
                      {accountMap.get(accountId) ?? "Select account…"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {activeAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {fixedAccountId ? "To Account" : "To"}
              </Label>
              <Select value={toAccountId} onValueChange={(v) => v && setToAccountId(v)}>
                <SelectTrigger className="h-8 min-w-[130px]">
                  <span className={`flex flex-1 items-center text-left truncate ${toAccountId ? "" : "text-muted-foreground"}`}>
                    {accountMap.get(toAccountId) ?? "Select account…"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {activeAccounts
                    .filter((a) => a.id !== (fixedAccountId ?? accountId))
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Date — popover calendar, one tap to pick */}
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Date</Label>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-[150px] justify-start gap-1.5 font-normal"
                />
              }
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm">{formatDateLabel(date)}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={parseLocalDate(date)}
                onSelect={(d) => {
                  if (d) setDate(toDateString(d));
                  setDatePickerOpen(false);
                }}
                defaultMonth={parseLocalDate(date)}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Merchant */}
        <div className="space-y-1 flex-1 min-w-[120px]">
          <Label className="text-[11px] text-muted-foreground">
            {type === "transfer" ? "Note" : "Merchant"}
          </Label>
          <Input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={type === "transfer" ? "Transfer note" : "Who did you pay?"}
            className="h-8"
          />
        </div>

        {/* Note — hidden for transfers (merchant field serves as note) */}
        {type !== "transfer" && (
          <div className="space-y-1 flex-1 min-w-[100px]">
            <Label className="text-[11px] text-muted-foreground">Note</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="h-8"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 self-end">
          {isEditing && (
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm">
            {isEditing ? <><Check className="h-3.5 w-3.5" /> Save</> : <><Plus className="h-3.5 w-3.5" /> Add</>}
          </Button>
        </div>
      </div>
    </form>
  );
}
