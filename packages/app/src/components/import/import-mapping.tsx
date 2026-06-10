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
import { Building2, ChevronDown, Plus } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

/** Maps a source string → existing entity ID, or "__create__" for new */
export type EntityMapping = Record<string, string>;

interface ImportMappingRowsProps {
  sourceAccounts: string[];
  accounts: Account[];
  accountMapping: EntityMapping;
  onAccountMappingChange: (mapping: EntityMapping) => void;
}

// ── Component ───────────────────────────────────────────────────

/** One row per imported account: the imported name → a target-account
 *  selector (an existing account, or create-on-merge — the default). Rendered
 *  inside the Map-accounts dialog the preview table's ACCOUNT cells open;
 *  edits apply live. */
export function ImportMappingRows({
  sourceAccounts,
  accounts,
  accountMapping,
  onAccountMappingChange,
}: ImportMappingRowsProps) {
  return (
    <div className="space-y-2.5">
      {sourceAccounts.map((source) => (
        <div key={source} className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <span className="truncate text-sm text-foreground/80">
              {source}
            </span>
          </div>
          <div className="w-52 shrink-0 [&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
            <AccountMappingSelector
              accounts={accounts}
              value={accountMapping[source]}
              sourceLabel={source}
              onChange={(v) =>
                onAccountMappingChange({
                  ...accountMapping,
                  [source]: v,
                })
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Account Mapping Selector ────────────────────────────────────

function AccountMappingSelector({
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
  const [open, setOpen] = useState(false);
  const active = accounts.filter((a) => !a.archived);
  const groups = ACCOUNT_TYPE_ORDER.filter((type) =>
    active.some((a) => a.type === type),
  );

  const isCreate = !value || value === "__create__";
  const selectedLabel = isCreate
    ? undefined
    : accounts.find((a) => a.id === value)?.name;

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
          {selectedLabel ?? `+ Create "${sourceLabel}"`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search accounts…" />
          <CommandList>
            <CommandEmpty>No accounts found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`+ Create "${sourceLabel}"`}
                data-checked={isCreate}
                onSelect={() => { onChange("__create__"); setOpen(false); }}
              >
                <span className="text-brand font-medium">
                  <Plus className="inline h-3 w-3 mr-1" />
                  Create &ldquo;{sourceLabel}&rdquo;
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
