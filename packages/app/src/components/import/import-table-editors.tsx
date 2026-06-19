import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { MerchantInput } from "@/components/budget/merchant-input";
import type { ImportTransaction } from "@capybudget/core";
import {
  parseMoney,
  centsToEditString,
  parseLocalDate,
  toDateString,
} from "@capybudget/core";
import { useTransactions } from "@/hooks/use-budget-data";
import { useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useFormatters } from "@/hooks/use-formatters";
import { amountColorClass } from "@/components/import/import-table-utils";
import { CalendarDays } from "lucide-react";

const inputClass =
  "h-7 w-full bg-transparent border-0 border-b border-brand/40 rounded-none px-1 text-[13px] focus:outline-none focus:ring-0 focus:border-brand/60 transition-colors";

export function DateEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (date: string) => void;
  onCancel: () => void;
}) {
  const { date } = useFormatters();
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
          <span>{date(value)}</span>
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

export function MerchantEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("import");
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
        placeholder={t("editors.merchantPlaceholder")}
      />
    </div>
  );
}

export function AmountEdit({
  txn,
  onSave,
  onCancel,
}: {
  txn: ImportTransaction;
  onSave: (cents: number) => void;
  onCancel: () => void;
}) {
  const { symbol, symbolPosition } = useFormatMoney();
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

  // The input holds the unsigned amount, so the sign rides ahead of the number.
  // A leading symbol fuses with it ("-$"); a trailing or absent symbol leaves
  // the sign alone in front and the symbol (if any) after the number.
  const colorClass = amountColorClass(txn);
  const after = symbolPosition === "after";
  const sign = txn.amount < 0 ? "-" : "";
  const span = (text: string) =>
    text ? <span className={`text-[13px] font-semibold ${colorClass}`}>{text}</span> : null;

  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-flex items-center justify-end">
      {span(after ? sign : `${sign}${symbol}`)}
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
        className={`${inputClass} text-right tabular-nums font-semibold ${colorClass}`}
        style={{ width: `${Math.max(value.length, 4) + 1}ch` }}
        placeholder="0.00"
      />
      {after && span(symbol && ` ${symbol}`)}
    </div>
  );
}

export function TypeEdit({
  value,
  onSave,
  onCancel,
}: {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("import");
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
        <option value="expense">{t("table.types.expense")}</option>
        <option value="income">{t("table.types.income")}</option>
        <option value="transfer">{t("table.types.transfer")}</option>
      </select>
    </div>
  );
}
