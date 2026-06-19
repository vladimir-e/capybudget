import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { currencySymbol } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { CURRENCY_CODES, type CurrencyCode } from "@/lib/currencies";
import type { BudgetKey } from "@/lib/i18n-keys";
import { ChevronDown } from "lucide-react";

interface CurrencyComboboxProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
}

// The catalog key is mechanically derived from the code; the annotation pins
// `currencyName.${CurrencyCode}` to a real `budget` key, so a missing entry
// fails typecheck rather than rendering a raw key.
const nameKey = (code: CurrencyCode): BudgetKey => `currencyName.${code}`;

export function CurrencyCombobox({ value, onChange, id, disabled }: CurrencyComboboxProps) {
  const { t } = useTranslation("budget");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            className="h-9 w-56 justify-between gap-1.5 font-normal"
          />
        }
      >
        <span className="truncate">
          {value} <span className="text-muted-foreground">{currencySymbol(value)}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("currency.search")} />
          <CommandList>
            <CommandEmpty>{t("currency.empty")}</CommandEmpty>
            <CommandGroup>
              {CURRENCY_CODES.map((code) => {
                const name = t(nameKey(code));
                return (
                  <CurrencyItem
                    key={code}
                    code={code}
                    name={name}
                    selected={code === value}
                    onSelect={() => {
                      onChange(code);
                      setOpen(false);
                    }}
                  />
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CurrencyItem({
  code,
  name,
  selected,
  onSelect,
}: {
  code: string;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  // `value` carries both code and name so Command's filter matches either.
  return (
    <CommandItem value={`${code} ${name}`} data-checked={selected} onSelect={onSelect}>
      <span className="font-medium">{code}</span>
      <span className="text-muted-foreground">{currencySymbol(code)}</span>
      <span className="truncate text-muted-foreground">{name}</span>
    </CommandItem>
  );
}
