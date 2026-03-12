import { useCallback, useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { AccountSelector } from "@/components/budget/account-selector";
import { CategorySelector } from "@/components/budget/category-selector";
import { parseMoney, getAmountClass } from "@/lib/money";
import { parseLocalDate, toDateString, formatDateLabel } from "@/lib/date-utils";
import type { Account, Category, Transaction } from "@/lib/types";
import type { TransactionFormData } from "@/services/transactions";
import { CalendarDays } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditableColumn = "date" | "account" | "category" | "merchant" | "amount";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents as an unsigned dollar string for editing: 1250 → "12.50" */
function centsToEditString(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${dollars}.${String(remainder).padStart(2, "0")}`;
}

const inputClass =
  "h-7 w-full bg-transparent border-0 border-b border-brand/40 rounded-none px-1 text-[13px] focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors";

// ---------------------------------------------------------------------------
// InlineEditCell — router component that delegates to the right cell editor
// ---------------------------------------------------------------------------

export function InlineEditCell({
  txn,
  column,
  accounts,
  categories,
  onSave,
  onCancel,
}: {
  txn: Transaction;
  column: EditableColumn;
  accounts: Account[];
  categories: Category[];
  onSave: (data: TransactionFormData) => void;
  onCancel: () => void;
}) {
  const buildFormData = useCallback(
    (patch: Partial<{ date: string; accountId: string; categoryId: string; merchant: string; amount: number }>) => {
      const current = {
        date: txn.datetime.slice(0, 10),
        accountId: txn.accountId,
        categoryId: txn.categoryId,
        merchant: txn.merchant,
        amount: Math.abs(txn.amount),
      };
      // Skip save if nothing actually changed
      const changed = Object.entries(patch).some(
        ([k, v]) => current[k as keyof typeof current] !== v,
      );
      if (!changed) { onCancel(); return; }

      const data: TransactionFormData = {
        id: txn.id,
        type: txn.type,
        ...current,
        note: txn.note,
        ...patch,
      };
      onSave(data);
    },
    [txn, onSave, onCancel],
  );

  // Stop click propagation so the parent TableCell's onClick doesn't re-enter edit mode
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (column === "date") {
    return <div onClick={stop}><DateEditCell txn={txn} onSave={(date) => buildFormData({ date })} onCancel={onCancel} /></div>;
  }
  if (column === "account") {
    return <div onClick={stop}><AccountEditCell txn={txn} accounts={accounts} onSave={(accountId) => buildFormData({ accountId })} onCancel={onCancel} /></div>;
  }
  if (column === "category") {
    return <div onClick={stop}><CategoryEditCell txn={txn} categories={categories} onSave={(categoryId) => buildFormData({ categoryId })} onCancel={onCancel} /></div>;
  }
  if (column === "merchant") {
    return <div onClick={stop}><MerchantEditCell txn={txn} onSave={(merchant) => buildFormData({ merchant })} onCancel={onCancel} /></div>;
  }
  // amount
  return <div onClick={stop}><AmountEditCell txn={txn} onSave={(amount) => buildFormData({ amount })} onCancel={onCancel} /></div>;
}

// ---------------------------------------------------------------------------
// Individual cell editors
// ---------------------------------------------------------------------------

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
  txn: Transaction; accounts: Account[];
  onSave: (accountId: string) => void; onCancel: () => void;
}) {
  return (
    <AccountSelector
      accounts={accounts}
      value={txn.accountId}
      defaultOpen
      onChange={(id) => onSave(id)}
      onOpenChange={(open) => { if (!open) onCancel(); }}
    />
  );
}

function CategoryEditCell({ txn, categories, onSave, onCancel }: {
  txn: Transaction; categories: Category[];
  onSave: (categoryId: string) => void; onCancel: () => void;
}) {
  return (
    <CategorySelector
      categories={categories}
      value={txn.categoryId || null}
      defaultOpen
      onChange={(id) => onSave(id ?? "")}
      onOpenChange={(open) => { if (!open) onCancel(); }}
      placeholder="Uncategorized"
      includeUncategorized
    />
  );
}

function MerchantEditCell({ txn, onSave, onCancel }: {
  txn: Transaction;
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

function AmountEditCell({ txn, onSave, onCancel }: {
  txn: Transaction;
  onSave: (amount: number) => void; onCancel: () => void;
}) {
  const [value, setValue] = useState(() => centsToEditString(txn.amount));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const save = () => { const cents = parseMoney(value); if (cents >= 0) onSave(cents); else onCancel(); };

  return (
    <div className="inline-flex items-center justify-end">
      <span className={`text-[13px] font-semibold ${getAmountClass(txn)}`}>
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
        className={`${inputClass} text-right tabular-nums font-semibold ${getAmountClass(txn)}`}
        style={{ width: `${Math.max(value.length, 4) + 1}ch` }}
        placeholder="0.00"
      />
    </div>
  );
}
