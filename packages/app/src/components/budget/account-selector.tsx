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
import type { Account } from "@capybudget/core";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { ChevronDown, X } from "lucide-react";

interface AccountSelectorProps {
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
  placeholder?: string;
  /** Show "All Accounts" as the first option (for filter use cases). */
  includeAll?: boolean;
  /** Show a clear button when an account is selected. */
  clearable?: boolean;
  /** Accounts to exclude from the list (e.g. the "from" account in transfers). */
  excludeIds?: string[];
  /** Accounts to show but disable (greyed out, not selectable). */
  disableIds?: string[];
  /** Show an "Unset" option that clears the selection (calls onChange("")). */
  includeUnset?: boolean;
  /** Start with the popover open. */
  defaultOpen?: boolean;
  /** Called when the popover opens or closes. */
  onOpenChange?: (open: boolean) => void;
}

export function AccountSelector({
  accounts,
  value,
  onChange,
  placeholder,
  includeAll = false,
  clearable = false,
  excludeIds = [],
  disableIds = [],
  includeUnset = false,
  defaultOpen = false,
  onOpenChange: onOpenChangeProp,
}: AccountSelectorProps) {
  const { t } = useTranslation("budget");
  const resolvedPlaceholder = placeholder ?? t("account.selector.placeholder");
  const [open, setOpen] = useState(defaultOpen);
  const handleOpenChange = (next: boolean) => { setOpen(next); onOpenChangeProp?.(next); };

  const active = accounts
    .filter((a) => !a.archived)
    .filter((a) => !excludeIds.includes(a.id));

  const groups = ACCOUNT_TYPE_ORDER.filter((type) =>
    active.some((a) => a.type === type),
  );

  const selectedLabel =
    value === "" && includeAll
      ? t("account.selector.all")
      : accounts.find((a) => a.id === value)?.name ?? resolvedPlaceholder;

  const showClear = clearable && value !== "";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className="flex items-center">
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={`h-8 justify-between gap-1.5 font-normal ${showClear ? "rounded-r-none border-r-0" : ""}`}
            />
          }
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        {showClear && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex h-8 items-center rounded-r-lg border border-input px-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
            aria-label={t("account.selector.clearFilter")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("account.selector.search")} />
          <CommandList>
            <CommandEmpty>{t("account.selector.empty")}</CommandEmpty>
            {includeUnset && (
              <CommandGroup>
                <CommandItem
                  value="— Unset"
                  onSelect={() => {
                    onChange("");
                    handleOpenChange(false);
                  }}
                >
                  <span className="text-muted-foreground italic">{t("account.selector.unset")}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {includeAll && (
              <CommandGroup>
                <CommandItem
                  value="All Accounts"
                  data-checked={value === ""}
                  onSelect={() => {
                    onChange("");
                    handleOpenChange(false);
                  }}
                >
                  {t("account.selector.all")}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map((type) => (
              <CommandGroup key={type} heading={ACCOUNT_TYPE_LABELS[type]}>
                {active
                  .filter((a) => a.type === type)
                  .map((a) => {
                    const isDisabled = disableIds.includes(a.id);
                    return (
                      <CommandItem
                        key={a.id}
                        value={a.name}
                        data-checked={a.id === value}
                        disabled={isDisabled}
                        onSelect={() => {
                          if (isDisabled) return;
                          onChange(a.id);
                          handleOpenChange(false);
                        }}
                        className={isDisabled ? "opacity-40 cursor-not-allowed" : ""}
                      >
                        {a.name}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
