import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account, Category } from "@capybudget/core";
import { ACCOUNT_TYPE_LABELS } from "@capybudget/core";
import { Building2, Tag } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

/** Maps a source string → existing entity ID, or "" for "create new" */
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
  const activeAccounts = accounts.filter((a) => !a.archived);
  const activeCategories = categories.filter((c) => !c.archived);

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
        {/* Account mappings */}
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
            <div className="space-y-2">
              {sourceAccounts.map((source) => (
                <MappingRow
                  key={source}
                  sourceLabel={source}
                  value={accountMapping[source] ?? undefined}
                  onChange={(value) =>
                    onAccountMappingChange({
                      ...accountMapping,
                      [source]: value,
                    })
                  }
                  options={activeAccounts.map((a) => ({
                    id: a.id,
                    label: a.name,
                    detail: ACCOUNT_TYPE_LABELS[a.type],
                  }))}
                  createLabel="Create new account"
                />
              ))}
            </div>
          </div>
        )}

        {/* Category mappings */}
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
            <div className="space-y-2">
              {sourceCategories.map((source) => (
                <MappingRow
                  key={source}
                  sourceLabel={source}
                  value={categoryMapping[source] ?? undefined}
                  onChange={(value) =>
                    onCategoryMappingChange({
                      ...categoryMapping,
                      [source]: value,
                    })
                  }
                  options={activeCategories.map((c) => ({
                    id: c.id,
                    label: c.name,
                    detail: c.group,
                  }))}
                  createLabel="Create new category"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mapping Row ─────────────────────────────────────────────────

function MappingRow({
  sourceLabel,
  value,
  onChange,
  options,
  createLabel,
}: {
  sourceLabel: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: { id: string; label: string; detail?: string }[];
  createLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
        {sourceLabel}
      </span>
      <div className="w-48 shrink-0">
        <Select value={value ?? ""} onValueChange={(v) => { if (v) onChange(v); }}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__create__">
              <span className="text-brand font-medium">+ {createLabel}</span>
            </SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                <span>{opt.label}</span>
                {opt.detail && (
                  <span className="ml-1.5 text-muted-foreground text-[10px]">
                    {opt.detail}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
