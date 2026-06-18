import { RotateCcw } from "lucide-react";
import type { TransactionType } from "@capybudget/core";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
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

const TYPE_OPTIONS: { value: TransactionType; label: string; tint: string }[] = [
  { value: "expense", label: "Expense", tint: "aria-pressed:bg-amount-expense/12 aria-pressed:text-amount-expense" },
  { value: "income", label: "Income", tint: "aria-pressed:bg-amount-income/12 aria-pressed:text-amount-income" },
  { value: "transfer", label: "Transfer", tint: "aria-pressed:bg-brand/12 aria-pressed:text-brand" },
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
            <ToggleGroupItem key={t.value} value={t.value} size="sm" className={`flex-1 ${t.tint}`}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={sectionLabel}>Show only</span>
        <div className="flex gap-2">
          <Toggle
            variant="outline"
            size="sm"
            className="flex-1"
            pressed={filters.uncategorizedOnly ?? false}
            onPressedChange={(pressed) => update({ uncategorizedOnly: pressed })}
          >
            Uncategorized
          </Toggle>
          <Toggle
            variant="outline"
            size="sm"
            className="flex-1"
            pressed={filters.noMerchantOnly ?? false}
            onPressedChange={(pressed) => update({ noMerchantOnly: pressed })}
          >
            No merchant
          </Toggle>
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
