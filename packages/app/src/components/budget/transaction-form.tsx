import { useState, useRef, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CategorySelector } from "@/components/budget/category-selector";
import { AccountSelector } from "@/components/budget/account-selector";
import { MerchantInput } from "@/components/budget/merchant-input";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import type { Transaction, TransactionType, TransactionFormData, TransferPair } from "@capybudget/core";
import { findCategoryForMerchant, resolveTransferPair, parseMoney, getToday, parseLocalDate, toDateString, currencySymbol, crossRateAmount, centsToEditString } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useCurrency, useCurrencies } from "@/contexts/currency-context";
import { useFormatters } from "@/hooks/use-formatters";
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

const TYPES: { value: TransactionType; icon: typeof Minus }[] = [
  { value: "expense", icon: Minus },
  { value: "income", icon: Plus },
  { value: "transfer", icon: ArrowLeftRight },
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

/** Seed values for the amount fields when editing, resolved by sign from the
 *  transfer pair so they never depend on which leg opened the editor.
 *  `outflowAmount` always seeds the from-leg amount; `inflowAmount` seeds the
 *  received amount and is non-empty only for a transfer (a non-transfer mirrors
 *  the from leg and shows no received field). */
function resolveEditLegs(
  editing: Transaction | null | undefined,
  pair: TransferPair | null,
): { outflowAmount: string; inflowAmount: string } {
  if (!editing) return { outflowAmount: "", inflowAmount: "" };
  if (editing.type !== "transfer") {
    return { outflowAmount: centsToEditString(editing.amount), inflowAmount: "" };
  }

  const legs = [editing, pair?.pairTransaction].filter(Boolean) as Transaction[];
  const outflow = legs.find((t) => t.amount < 0) ?? editing;
  const inflow = legs.find((t) => t.amount > 0) ?? editing;
  return {
    outflowAmount: centsToEditString(outflow.amount),
    inflowAmount: centsToEditString(inflow.amount),
  };
}

export function TransactionForm({
  editingTransaction,
  defaultAccountId: defaultAccountIdProp,
  amountRef: externalAmountRef,
  onSave,
  onCancel,
  onDismiss,
}: TransactionFormProps) {
  const { t } = useTranslation(["budget", "common"]);
  const defaultCurrency = useCurrency();
  const currencies = useCurrencies();
  const { date: formatDate } = useFormatters();
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

  // `resolveTransferPair` assigns an unpaired leg's account by amount sign, so a
  // positive (income) flow lands in `toAccountId` and leaves `fromAccountId` "".
  // That's correct only for transfers; a plain flow's account is simply its own,
  // so seed it from `accountId` and reserve the pair logic for actual transfers.
  const initialTransfer = editingTransaction?.type === "transfer"
    ? resolveTransferPair(editingTransaction, allTransactions)
    : null;
  const initialFrom =
    initialTransfer?.fromAccountId ?? editingTransaction?.accountId ?? defaultAccountId;
  const initialTo = initialTransfer?.toAccountId ?? "";

  // Both leg magnitudes resolved by sign from the transfer pair, never from
  // which row opened the editor: `amount` must always seed from the outflow
  // (from) leg and the received amount from the inflow (to) leg, or editing a
  // cross-currency transfer from the inflow row writes the inflow magnitude
  // back onto the from-leg and corrupts it. For a same-currency transfer the
  // legs are equal; for a non-transfer the inflow magnitude stays empty.
  const editLegs = resolveEditLegs(editingTransaction, initialTransfer);
  const [amount, setAmount] = useState(editLegs.outflowAmount);
  const [toAmount, setToAmount] = useState(editLegs.inflowAmount);
  const [toAmountEdited, setToAmountEdited] = useState(editLegs.inflowAmount !== "");
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
  const [toAccountError, setToAccountError] = useState(false);

  // Sync account to current context when form has no content (e.g. navigating between accounts)
  const [prevDefaultAccountId, setPrevDefaultAccountId] = useState(defaultAccountId);
  if (defaultAccountId !== prevDefaultAccountId) {
    setPrevDefaultAccountId(defaultAccountId);
    if (!amount) {
      setAccountId(defaultAccountId);
    }
  }

  // Per-leg currencies drive the cross-currency UX: when a transfer's two
  // accounts hold different currencies, a second "received" amount appears in
  // the to-account's currency. Everything below collapses to the
  // single-currency UX when they match — and an all-default budget always
  // matches, so it never changes.
  const fromCurrency = accounts.find((a) => a.id === accountId)?.currency ?? defaultCurrency;
  const toCurrency = accounts.find((a) => a.id === toAccountId)?.currency ?? defaultCurrency;
  const isCrossCurrency = type === "transfer" && !!toAccountId && fromCurrency !== toCurrency;
  const fromSymbol = currencySymbol(fromCurrency);
  const toSymbol = currencySymbol(toCurrency);

  // A plain flow's amount is native to its account's currency, so moving it to a
  // different-currency account would silently revalue the number. Lock the
  // selector to same-currency accounts while editing an existing non-transfer
  // (a transfer legitimately spans currencies; a fresh entry has no amount to
  // preserve, so any account is valid).
  const lockCurrency = isEditing && type !== "transfer";
  const sameCurrencyDisabledIds = lockCurrency
    ? accounts.filter((a) => a.currency !== fromCurrency).map((a) => a.id)
    : [];

  // Prefill the received amount from the display cross-rate
  // rate(from→to) = rate(from→default) / rate(to→default), until the user
  // overrides it. Reads through the live `amount`, so editing either side
  // keeps the other in sync while untouched.
  let displayToAmount = toAmount;
  if (isCrossCurrency && !toAmountEdited) {
    const fromCents = parseMoney(amount);
    displayToAmount = fromCents > 0
      ? centsToEditString(crossRateAmount(fromCents, fromCurrency, toCurrency, currencies, defaultCurrency))
      : "";
  }

  function resetForm() {
    setAmount("");
    setToAmount("");
    setToAmountEdited(false);
    setType("expense");
    setCategoryId(null);
    setAccountId(defaultAccountId);
    setToAccountId("");
    setDate(getToday());
    setMerchant("");
    setNote("");
    setAccountError(false);
    setToAccountError(false);
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
    if (type === "transfer" && !toAccountId) {
      setToAccountError(true);
      return;
    }

    onSave({
      id: editingTransaction?.id,
      type,
      amount: cents,
      categoryId: type === "transfer" ? "" : (categoryId ?? ""),
      accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      // Only a cross-currency transfer carries an independent received amount;
      // same-currency transfers mirror the from amount (toAmount stays absent).
      toAmount: isCrossCurrency ? parseMoney(displayToAmount) : undefined,
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

  function handleToAmountChange(raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    if (parts.length > 2) return;
    if (parts[1] && parts[1].length > 2) return;
    setToAmountEdited(true);
    setToAmount(cleaned);
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
        <span>{t("transaction.form.addPrompt")}</span>
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
          {TYPES.map(({ value, icon: Icon }) => {
            const active = type === value;
            // Editing can't cross the transfer boundary in either direction — the
            // legs are paired and a conversion would orphan the partner (spec:
            // delete and recreate instead). An existing transfer locks to
            // "transfer"; an existing income/expense locks "transfer" out.
            const locked =
              isEditing && (editingTransaction?.type === "transfer") !== (value === "transfer");
            return (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                disabled={locked}
                onClick={() => setType(value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  active ? TYPE_COLORS[value].pill : "text-muted-foreground hover:text-foreground"
                } ${locked ? "opacity-30 cursor-not-allowed" : ""}`}
              >
                <Icon className="h-3 w-3" />
                {t(`transaction.type.${value}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount + Date */}
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-0.5 flex-1 min-w-0">
          {/* Symbol sits before the amount even for symbol-after budgets: this
              is a full-width entry field, so a trailing symbol would float far
              from the left-aligned number. The display formatter still honors
              position everywhere money is rendered read-only. */}
          {fromSymbol && (
            <span className={`text-2xl font-bold transition-colors ${colors.text}`}>{fromSymbol}</span>
          )}
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
            <span className="text-sm">{formatDate(date)}</span>
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
              onDayKeyDown={(day, _modifiers, e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setDate(toDateString(day));
                  setDatePickerOpen(false);
                }
              }}
              defaultMonth={parseLocalDate(date)}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Context fields */}
      {type !== "transfer" ? (
        <>
          <MerchantInput
            value={merchant}
            onChange={setMerchant}
            onSelect={(m) => {
              if (!categoryId) {
                const catId = findCategoryForMerchant(allTransactions, m);
                if (catId) setCategoryId(catId);
              }
            }}
            transactions={allTransactions}
            className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            placeholder={t("transaction.form.merchantPlaceholder")}
          />
          <div className="[&>div]:w-full [&_button:first-of-type]:w-full">
            <CategorySelector
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              placeholder={t("transaction.form.categoryPlaceholder")}
              includeUncategorized
            />
          </div>
          <div className="space-y-1">
            <div className={`[&>div]:w-full [&_button:first-of-type]:w-full ${accountError ? "[&_button:first-of-type]:border-destructive [&_button:first-of-type]:ring-1 [&_button:first-of-type]:ring-destructive/30" : ""}`}>
              <AccountSelector
                accounts={accounts}
                value={accountId}
                onChange={(id) => { setAccountId(id); setAccountError(false); }}
                disableIds={sameCurrencyDisabledIds}
              />
            </div>
            {accountError && (
              <p className="text-xs text-destructive">{t("transaction.form.selectAccount")}</p>
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
            <div className={`flex-1 min-w-0 [&>div]:w-full [&_button:first-of-type]:w-full ${toAccountError ? "[&_button:first-of-type]:border-destructive [&_button:first-of-type]:ring-1 [&_button:first-of-type]:ring-destructive/30" : ""}`}>
              <AccountSelector
                accounts={accounts}
                value={toAccountId}
                onChange={(id) => { setToAccountId(id); setToAccountError(false); }}
                placeholder={t("account.selector.to")}
                excludeIds={[accountId]}
              />
            </div>
          </div>
          {(accountError || toAccountError) && (
            <p className="text-xs text-destructive">{accountError && toAccountError ? t("transaction.form.selectBothAccounts") : t("transaction.form.selectAccount")}</p>
          )}
          </div>

          {/* Received amount — only when the two accounts differ in currency.
              Prefilled from the display cross-rate, fully editable (the user
              enters what actually landed). */}
          {isCrossCurrency && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("transaction.form.receivedAmount")}</label>
              <div className="flex items-baseline gap-0.5">
                {toSymbol && (
                  <span className={`text-lg font-semibold ${colors.text}`}>{toSymbol}</span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  value={displayToAmount}
                  onChange={(e) => handleToAmountChange(e.target.value)}
                  placeholder="0.00"
                  className={`bg-transparent text-lg font-semibold tabular-nums outline-none w-full placeholder:text-muted-foreground/20 ${colors.text}`}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Notes */}
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("transaction.form.notesPlaceholder")}
        className="text-muted-foreground"
      />

      {/* Submit */}
      <div className="flex items-center gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" className="flex-1" tabIndex={-1} onClick={() => { resetForm(); onDismiss?.(); }}>
          {t("common:actions.cancel")}
        </Button>
        <Button type="submit" size="sm" className="flex-1">
          {isEditing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isEditing ? t("common:actions.save") : t("common:actions.add")}
        </Button>
      </div>
    </form>
  );
}
