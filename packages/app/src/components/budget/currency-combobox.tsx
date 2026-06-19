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
import { CURRENCIES, type CurrencyOption } from "@/lib/currencies";
import { ChevronDown } from "lucide-react";

interface CurrencyComboboxProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
}

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
              {CURRENCIES.map((c) => (
                <CurrencyItem
                  key={c.code}
                  option={c}
                  selected={c.code === value}
                  onSelect={() => {
                    onChange(c.code);
                    setOpen(false);
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CurrencyItem({
  option,
  selected,
  onSelect,
}: {
  option: CurrencyOption;
  selected: boolean;
  onSelect: () => void;
}) {
  // `value` carries both code and name so Command's filter matches either.
  return (
    <CommandItem value={`${option.code} ${option.name}`} data-checked={selected} onSelect={onSelect}>
      <span className="font-medium">{option.code}</span>
      <span className="text-muted-foreground">{currencySymbol(option.code)}</span>
      <span className="truncate text-muted-foreground">{option.name}</span>
    </CommandItem>
  );
}
