import { Check, RotateCcw } from "lucide-react";
import type { TransactionType } from "@capybudget/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ALL_TRANSACTION_TYPES,
  hasSecondaryFilters,
  type TransactionFilterCriteria,
} from "@/lib/filter-transactions";

interface TransactionFilterPopoverProps {
  filters: TransactionFilterCriteria;
  update: (patch: Partial<TransactionFilterCriteria>) => void;
}

/** Selected = semantic color (text + border + light tint); unselected = muted
 *  with a transparent fill, so the colored/checked vs. muted contrast carries
 *  the on/off state rather than the background tint alone. */
const TYPE_OPTIONS: { value: TransactionType; label: string; selected: string }[] = [
  {
    value: "expense",
    label: "Expense",
    selected: "aria-pressed:bg-amount-expense/12 aria-pressed:text-amount-expense aria-pressed:border-amount-expense/40",
  },
  {
    value: "income",
    label: "Income",
    selected: "aria-pressed:bg-amount-income/12 aria-pressed:text-amount-income aria-pressed:border-amount-income/40",
  },
  {
    value: "transfer",
    label: "Transfer",
    selected: "aria-pressed:bg-brand/12 aria-pressed:text-brand aria-pressed:border-brand/40",
  },
];

const sectionLabel =
  "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60";

export function TransactionFilterPopover({ filters, update }: TransactionFilterPopoverProps) {
  const selected = filters.types ?? [...ALL_TRANSACTION_TYPES];
  const showReset = hasSecondaryFilters(filters);

  const reset = () =>
    update({ types: [...ALL_TRANSACTION_TYPES], uncategorizedOnly: false, noMerchantOnly: false });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Type</span>
        <ToggleGroup
          multiple
          variant="outline"
          spacing={2}
          value={selected}
          onValueChange={(value) => update({ types: value as TransactionType[] })}
        >
          {TYPE_OPTIONS.map((t) => (
            <ToggleGroupItem
              key={t.value}
              value={t.value}
              size="sm"
              className={`flex-1 text-muted-foreground ${t.selected}`}
            >
              <Check className="h-3 w-3 opacity-0 group-data-pressed/toggle:opacity-100" />
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Show only</span>
        <div className="flex flex-col gap-1.5">
          <CheckRow
            label="Uncategorized"
            checked={filters.uncategorizedOnly ?? false}
            onChange={(checked) => update({ uncategorizedOnly: checked })}
          />
          <CheckRow
            label="No merchant"
            checked={filters.noMerchantOnly ?? false}
            onChange={(checked) => update({ noMerchantOnly: checked })}
          />
        </div>
      </div>

      {showReset && (
        <div className="flex justify-end">
          <Button variant="ghost" size="xs" onClick={reset} className="text-muted-foreground">
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </Button>
        </div>
      )}
    </div>
  );
}

interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CheckRow({ label, checked, onChange }: CheckRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className={`text-sm ${checked ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
    </label>
  );
}
