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
import { ChevronDown, Plus } from "lucide-react";

/** The per-source-account destination picker: an existing account grouped by
 *  type, or create-on-merge (the default). Its Popover renders in a portal, so
 *  it stays visible when the rows it lives in scroll inside a capped container.
 *  Shared by the Map-accounts dialog and the merge confirmation. */
export function AccountMappingSelector({
  accounts,
  value,
  sourceLabel,
  onChange,
}: {
  accounts: Account[];
  value: string | undefined;
  sourceLabel: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("import");
  const [open, setOpen] = useState(false);
  const active = accounts.filter((a) => !a.archived);
  const groups = ACCOUNT_TYPE_ORDER.filter((type) =>
    active.some((a) => a.type === type),
  );

  const isCreate = !value || value === "__create__";
  const selectedLabel = isCreate
    ? undefined
    : accounts.find((a) => a.id === value)?.name;
  const createLabel = t("accountMapping.create", { source: sourceLabel });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-8 justify-between gap-1.5 font-normal"
          />
        }
      >
        <span className={`truncate ${selectedLabel ? "" : "text-muted-foreground"}`}>
          {selectedLabel ?? `+ ${createLabel}`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("accountMapping.searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("accountMapping.empty")}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`+ ${createLabel}`}
                data-checked={isCreate}
                onSelect={() => { onChange("__create__"); setOpen(false); }}
              >
                <span className="text-brand font-medium">
                  <Plus className="inline h-3 w-3 mr-1" />
                  {createLabel}
                </span>
              </CommandItem>
            </CommandGroup>
            {groups.map((type) => (
              <CommandGroup key={type} heading={ACCOUNT_TYPE_LABELS[type]}>
                {active
                  .filter((a) => a.type === type)
                  .map((a) => (
                    <CommandItem
                      key={a.id}
                      value={a.name}
                      data-checked={a.id === value}
                      onSelect={() => { onChange(a.id); setOpen(false); }}
                    >
                      {a.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
