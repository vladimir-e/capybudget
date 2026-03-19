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
import type { Account, Category } from "@capybudget/core";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@capybudget/core";
import { Building2, ChevronDown, Plus, Tag } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

/** Maps a source string → existing entity ID, or "__create__" for new */
export type EntityMapping = Record<string, string>;

interface ImportMappingProps {
  sourceAccounts: string[];
  sourceCategories: string[];
  accounts: Account[];
  categories: Category[];
  accountMapping: EntityMapping;
  categoryMapping: EntityMapping;
  onAccountMappingChange: (mapping: EntityMapping) => void;
  onCategoryMappingChange: (mapping: EntityMapping) => void;
}

// ── Component ───────────────────────────────────────────────────

export function ImportMapping({
  sourceAccounts,
  sourceCategories,
  accounts,
  categories,
  accountMapping,
  categoryMapping,
  onAccountMappingChange,
  onCategoryMappingChange,
}: ImportMappingProps) {
  const hasAccounts = sourceAccounts.length > 0;
  const hasCategories = sourceCategories.length > 0;

  if (!hasAccounts && !hasCategories) return null;

  const allAccountsMapped = sourceAccounts.every((s) => s in accountMapping);
  const allCategoriesMapped = sourceCategories.every(
    (s) => s in categoryMapping,
  );

  return (
    <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30 bg-muted/20">
        <h3 className="text-sm font-semibold text-foreground">
          Map to your budget
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Match imported accounts and categories to existing ones, or create new
          entries on merge.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/30">
        {hasAccounts && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Building2 className="h-3.5 w-3.5" />
              Accounts
              {allAccountsMapped && (
                <span className="ml-auto text-amount-income text-[10px] font-medium normal-case tracking-normal">
                  All mapped
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {sourceAccounts.map((source) => (
                <div key={source} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
                    {source}
                  </span>
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
          </div>
        )}

        {hasCategories && (
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              <Tag className="h-3.5 w-3.5" />
              Categories
              {allCategoriesMapped && (
                <span className="ml-auto text-amount-income text-[10px] font-medium normal-case tracking-normal">
                  All mapped
                </span>
              )}
            </div>
            <div className="space-y-2.5">
              {sourceCategories.map((source) => (
                <div key={source} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
                    {source}
                  </span>
                  <div className="w-52 shrink-0 [&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
                    <CategoryMappingSelector
                      categories={categories}
                      value={categoryMapping[source]}
                      sourceLabel={source}
                      onChange={(v) =>
                        onCategoryMappingChange({
                          ...categoryMapping,
                          [source]: v,
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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

// ── Category Mapping Selector ───────────────────────────────────

function CategoryMappingSelector({
  categories,
  value,
  sourceLabel,
  onChange,
}: {
  categories: Category[];
  value: string | undefined;
  sourceLabel: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = categories.filter((c) => !c.archived);
  const groups = [...new Set(active.map((c) => c.group))];

  const isCreate = !value || value === "__create__";
  const selectedLabel = isCreate
    ? undefined
    : categories.find((c) => c.id === value)?.name;

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
          <CommandInput placeholder="Search categories…" />
          <CommandList>
            <CommandEmpty>No categories found.</CommandEmpty>
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
            {groups.map((group) => (
              <CommandGroup key={group} heading={group}>
                {active
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      data-checked={c.id === value}
                      onSelect={() => { onChange(c.id); setOpen(false); }}
                    >
                      {c.name}
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
