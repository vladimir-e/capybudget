import { useState, useRef, useEffect, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import { resolveTransferPair } from "@/lib/queries";
import type { Transaction, TransactionType } from "@/lib/types";
import type { TransactionFormData } from "@/services/transactions";
import { parseMoney } from "@/lib/money";
import { Minus, Plus, ArrowLeftRight, Check, CalendarDays } from "lucide-react";

interface TransactionFormProps {
  editingTransaction?: Transaction | null;
  /** Pre-select this account (e.g. when on an account page). Selector always shown. */
  defaultAccountId?: string;
  /** External ref for the amount input (panel mode). */
  amountRef?: RefObject<HTMLInputElement | null>;
  onSave: (data: TransactionFormData) => void;
  onCancel?: () => void;
  /** When provided, form runs in "panel mode": always expanded, Escape-with-no-content calls this. */
  onDismiss?: () => void;
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

export function TransactionForm({
  editingTransaction,
  defaultAccountId: defaultAccountIdProp,
  amountRef: externalAmountRef,
  onSave,
  onCancel,
  onDismiss,
}: TransactionFormProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: allTransactions = [] } = useTransactions();
  const internalAmountRef = useRef<HTMLInputElement>(null);
  const amountRef = externalAmountRef ?? internalAmountRef;
  const panelMode = !!onDismiss;
  const activeAccounts = accounts.filter((a) => !a.archived);
  const defaultAccountId = defaultAccountIdProp ?? (activeAccounts.length === 1 ? activeAccounts[0].id : "");
  const isEditing = !!editingTransaction;

  const [expanded, setExpanded] = useState(isEditing);

  const initialTransfer = editingTransaction
    ? resolveTransferPair(editingTransaction, allTransactions)
    : null;
  const initialFrom = initialTransfer?.fromAccountId ?? defaultAccountId;
  const initialTo = initialTransfer?.toAccountId ?? "";

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
  const [accountError, setAccountError] = useState(false);

  // Sync account to current context when form has no content (e.g. navigating between accounts)
  useEffect(() => {
    if (!amount) {
      setAccountId(defaultAccountId);
    }
  }, [defaultAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetForm() {
    setAmount("");
    setType("expense");
    setCategoryId(null);
    setAccountId(defaultAccountId);
    setToAccountId("");
    setDate(getToday());
    setMerchant("");
    setNote("");
    setAccountError(false);
    setTimeout(() => amountRef.current?.focus(), 0);
  }

  function handleCancel() {
    resetForm();
    onCancel?.();
  }

  function handleSubmit() {
    if (amount.trim() === "") {
      amountRef.current?.focus();
      return;
    }
    const cents = parseMoney(amount);
    if (!accountId) {
      setAccountError(true);
      return;
    }
    if (type === "transfer" && !toAccountId) return;

    onSave({
      id: editingTransaction?.id,
      type,
      amount: cents,
      categoryId: type === "transfer" ? "" : (categoryId ?? ""),
      accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      date,
      merchant: type === "transfer" ? "" : merchant.trim(),
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

  // ── Collapsed state (inline mode only) ──────────────────
  if (!panelMode && !expanded) {
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
          } else if (panelMode) {
            onDismiss?.();
          } else {
            setExpanded(false);
          }
        }
      }}
      className="space-y-3"
    >
      {/* Type selector */}
      <div className="flex justify-center">
        <div className="flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
          {TYPES.map(({ value, label, icon: Icon }) => {
            const active = type === value;
            return (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                onClick={() => setType(value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  active ? TYPE_COLORS[value].pill : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount + Date */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-0.5 flex-1 min-w-0">
          <span className={`text-2xl font-bold transition-colors ${colors.text}`}>$</span>
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
            autoFocus={!panelMode}
            className={`bg-transparent text-2xl font-bold tabular-nums outline-none w-full transition-colors placeholder:text-muted-foreground/20 ${colors.text}`}
          />
        </div>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                className="h-9 justify-start gap-1.5 font-normal shrink-0"
              />
            }
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{formatDateLabel(date)}</span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="single"
              required
              selected={parseLocalDate(date)}
              onSelect={(d) => {
                setDate(toDateString(d));
                setDatePickerOpen(false);
              }}
              defaultMonth={parseLocalDate(date)}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Context fields */}
      {type !== "transfer" ? (
        <>
          <Input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Merchant"
          />
          <div className="[&>div]:w-full [&_button:first-of-type]:w-full">
            <CategorySelector
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Category"
              includeUncategorized
            />
          </div>
          <div className="space-y-1">
            <div className={`[&>div]:w-full [&_button:first-of-type]:w-full ${accountError ? "[&_button:first-of-type]:border-destructive [&_button:first-of-type]:ring-1 [&_button:first-of-type]:ring-destructive/30" : ""}`}>
              <AccountSelector
                accounts={accounts}
                value={accountId}
                onChange={(id) => { setAccountId(id); setAccountError(false); }}
              />
            </div>
            {accountError && (
              <p className="text-xs text-destructive">Please select an account</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className={`flex-1 min-w-0 [&>div]:w-full [&_button:first-of-type]:w-full ${accountError ? "[&_button:first-of-type]:border-destructive [&_button:first-of-type]:ring-1 [&_button:first-of-type]:ring-destructive/30" : ""}`}>
                <AccountSelector
                  accounts={accounts}
                  value={accountId}
                  onChange={(id) => { setAccountId(id); setAccountError(false); }}
                />
              </div>
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <div className="flex-1 min-w-0 [&>div]:w-full [&_button:first-of-type]:w-full">
              <AccountSelector
                accounts={accounts}
                value={toAccountId}
                onChange={setToAccountId}
                placeholder="To…"
                excludeIds={[accountId]}
              />
            </div>
          </div>
          {accountError && (
            <p className="text-xs text-destructive">Please select an account</p>
          )}
          </div>
        </>
      )}

      {/* Notes */}
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notes (optional)"
        className="text-muted-foreground"
      />

      {/* Submit */}
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={isEditing ? handleCancel : () => onDismiss?.()}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="flex-1">
          {isEditing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isEditing ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
