import { AccountSelector } from "@/components/budget/account-selector";
import { CategorySelector } from "@/components/budget/category-selector";
import type { Account, Category } from "@capybudget/core";
import { Building2, Plus, Tag } from "lucide-react";

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
            <div className="space-y-2.5">
              {sourceAccounts.map((source) => (
                <AccountMappingRow
                  key={source}
                  sourceLabel={source}
                  value={accountMapping[source]}
                  accounts={accounts}
                  onChange={(value) =>
                    onAccountMappingChange({
                      ...accountMapping,
                      [source]: value,
                    })
                  }
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
            <div className="space-y-2.5">
              {sourceCategories.map((source) => (
                <CategoryMappingRow
                  key={source}
                  sourceLabel={source}
                  value={categoryMapping[source]}
                  categories={categories}
                  onChange={(value) =>
                    onCategoryMappingChange({
                      ...categoryMapping,
                      [source]: value,
                    })
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Account Mapping Row ─────────────────────────────────────────

function AccountMappingRow({
  sourceLabel,
  value,
  accounts,
  onChange,
}: {
  sourceLabel: string;
  value: string | undefined;
  accounts: Account[];
  onChange: (value: string) => void;
}) {
  const isCreateNew = value === "__create__";
  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
        {sourceLabel}
      </span>
      <div className="w-52 shrink-0">
        {isCreateNew ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-dashed border-brand/40 bg-brand/5 px-3 text-xs text-brand font-medium hover:bg-brand/10 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Create &ldquo;{sourceLabel}&rdquo;
          </button>
        ) : (
          <div className="[&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
            <AccountSelector
              accounts={accounts}
              value={value ?? ""}
              onChange={(id) => onChange(id || "__create__")}
              placeholder="Select account..."
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Category Mapping Row ────────────────────────────────────────

function CategoryMappingRow({
  sourceLabel,
  value,
  categories,
  onChange,
}: {
  sourceLabel: string;
  value: string | undefined;
  categories: Category[];
  onChange: (value: string) => void;
}) {
  const isCreateNew = value === "__create__";

  return (
    <div className="flex items-center gap-3">
      <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
        {sourceLabel}
      </span>
      <div className="w-52 shrink-0">
        {isCreateNew ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-dashed border-brand/40 bg-brand/5 px-3 text-xs text-brand font-medium hover:bg-brand/10 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Create &ldquo;{sourceLabel}&rdquo;
          </button>
        ) : (
          <div className="[&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
            <CategorySelector
              categories={categories}
              value={value ?? null}
              onChange={(id) => onChange(id ?? "__create__")}
              placeholder="Select category..."
            />
          </div>
        )}
      </div>
    </div>
  );
}
