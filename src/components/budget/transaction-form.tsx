import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import type { Account, Category, Transaction, TransactionType } from "@/lib/types";
import { parseMoney } from "@/lib/money";
import { Minus, Plus, ArrowLeftRight, Check, CalendarDays, X } from "lucide-react";

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

function parseLocalDate(s: string): Date {
  return new Date(s + "T12:00:00");
}

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
 * Transaction form with collapsible entry.
 *
 * Collapsed: a subtle "Add transaction…" prompt.
 * Expanded: full form with all fields.
 *
 * Stays expanded during rapid entry (add → reset → keep typing).
 * Auto-collapses when editing is done (key-based remount resets to collapsed).
 *
 * Use `key={editingTxn?.id ?? "new"}` on the parent to remount cleanly.
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
  const defaultAccountId = fixedAccountId ?? activeAccounts[0]?.id ?? "";
  const isEditing = !!editingTransaction;

  // Editing always starts expanded; add mode starts collapsed
  const [expanded, setExpanded] = useState(isEditing);

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

  function handleAmountChange(raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setAmount(cleaned);
  }

  const colors = TYPE_COLORS[type];
  const hasContent = !!(amount || merchant || note);

  // ── Collapsed state ──────────────────────────────────────
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="group flex w-full items-center gap-2 rounded-lg border border-dashed border-border/50 px-4 py-2.5 text-sm text-muted-foreground/50 transition-colors hover:border-border hover:bg-muted/20 hover:text-muted-foreground"
      >
        <Plus className="h-4 w-4 transition-colors group-hover:text-foreground" />
        <span>Add transaction…</span>
      </button>
    );
  }

  // ── Expanded state ───────────────────────────────────────
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          if (isEditing) {
            handleCancel();
          } else if (hasContent) {
            resetForm();
          } else {
            setExpanded(false);
          }
        }
      }}
      className="rounded-xl border bg-card/50 px-5 py-3.5 space-y-2"
    >
      {/* Line 1: Amount · Type · Date */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-14">
        <div className="flex items-baseline gap-0.5">
          <span className={`text-xl font-semibold transition-colors ${colors.text}`}>$</span>
          <input
            ref={amountRef}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "-" || e.key === "_") { e.preventDefault(); setType("expense"); }
              else if (e.key === "+" || e.key === "=") { e.preventDefault(); setType("income"); }
            }}
            placeholder="0.00"
            autoFocus
            className={`bg-transparent text-xl font-semibold tabular-nums outline-none w-28 transition-colors placeholder:text-muted-foreground/30 ${colors.text}`}
          />
        </div>

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

        <div className="ml-auto flex items-center gap-2">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 justify-start gap-1.5 font-normal"
                />
              }
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm">{formatDateLabel(date)}</span>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
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

          {!isEditing && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => { resetForm(); setExpanded(false); }}
              className="rounded-md p-1.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Line 2: Pay to + Category (or Transfer From/To) */}
      <div className="flex items-center gap-3">
        {type !== "transfer" ? (
          <>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0 w-11">Pay to</span>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Merchant"
              className="h-8 flex-1 min-w-0"
            />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0">For</span>
            <div className="flex-1 min-w-0 [&>div]:w-full [&_button:first-of-type]:w-full">
              <CategorySelector
                categories={categories}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Category"
              />
            </div>
          </>
        ) : !fixedAccountId ? (
          <>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0 w-11">From</span>
            <div className="flex-1 [&>div]:w-full [&_button:first-of-type]:w-full">
              <AccountSelector
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
              />
            </div>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0">To</span>
            <div className="flex-1 [&>div]:w-full [&_button:first-of-type]:w-full">
              <AccountSelector
                accounts={accounts}
                value={toAccountId}
                onChange={setToAccountId}
                placeholder="To…"
                excludeIds={[accountId]}
              />
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0 w-11">To</span>
            <div className="flex-1 [&>div]:w-full [&_button:first-of-type]:w-full">
              <AccountSelector
                accounts={accounts}
                value={toAccountId}
                onChange={setToAccountId}
                placeholder="Select account…"
                excludeIds={[fixedAccountId]}
              />
            </div>
          </>
        )}
      </div>

      {/* Line 3: [From Account +] Memo + Submit */}
      <div className="flex items-center gap-3">
        {!fixedAccountId && type !== "transfer" ? (
          <>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0 w-11">From</span>
            <div className="shrink-0 [&>div]:w-full [&_button:first-of-type]:w-full">
              <AccountSelector
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
              />
            </div>
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0">Memo</span>
          </>
        ) : (
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/50 shrink-0 w-11">Memo</span>
        )}
        <Input
          value={type !== "transfer" ? note : merchant}
          onChange={(e) => type !== "transfer" ? setNote(e.target.value) : setMerchant(e.target.value)}
          placeholder="Optional"
          className="h-8 flex-1"
        />

        {isEditing ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              <Check className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        ) : (
          <Button type="submit" size="sm" className="shrink-0">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>
    </form>
  );
}
