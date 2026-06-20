import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Category, Transaction } from "@capybudget/core";
import { searchTransactions } from "@capybudget/core";
import { useLocale, useTranslation } from "@capybudget/i18n";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TransactionList } from "@/components/budget/transaction-list";
import { VIRTUALIZE_THRESHOLD } from "@/components/budget/transaction-list-utils";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { useCategoryDisplayName } from "@/lib/display-names";
import {
  DEFAULT_SORT,
  sortTransactions,
  type SortConfig,
} from "@/lib/filter-transactions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Locked context the browser displays as non-removable chips. Callers
 *  pre-filter `transactions` themselves; these fields drive the chip row
 *  and the title bar — they are not re-applied to the data here.
 *
 *  `dateRange.to` is **exclusive** (first instant *after* the period) to
 *  match the analytics `DateRange.end` convention. The chip renderer
 *  subtracts one day internally so the displayed range is inclusive. */
export interface LockedFilters {
  categoryId?: string;
  /** A set of category ids the drilldown spans (`""` = Uncategorized) — used
   *  when no single category applies, e.g. the Compare tab's multi-category
   *  drilldown. Rendered as one chip per category, collapsing to an
   *  "N categories" chip past `CATEGORY_CHIP_LIMIT`. Independent of the
   *  single-`categoryId` path, which Spending/Merchants keep using. */
  categoryIds?: string[];
  merchant?: string;
  dateRange?: { from: Date; to: Date };
}

interface TransactionsBrowserProps {
  /** Already pre-filtered by the caller — the browser does not re-filter
   *  by `lockedFilters`, only displays them. */
  transactions: Transaction[];
  lockedFilters: LockedFilters;
  title: string;
  subtitle?: string;
}

/** Below this row count, the search field adds clutter without value. */
const SEARCH_THRESHOLD = 10;

/** Past this many categories in a multi-category lock, collapse to a single
 *  "N categories" chip rather than papering the row with name chips. */
const CATEGORY_CHIP_LIMIT = 4;

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

function formatChipDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function FilterChips({
  locked,
  categories,
}: {
  locked: LockedFilters;
  categories: Category[];
}) {
  const { t } = useTranslation("budget");
  const locale = useLocale();
  const categoryDisplay = useCategoryDisplayName();

  const categoryName = (id: string): string => {
    const cat = categories.find((c) => c.id === id);
    return cat ? categoryDisplay(cat.name) : t("browser.uncategorized");
  };

  const chips: string[] = [];

  if (locked.categoryId !== undefined) {
    chips.push(categoryName(locked.categoryId));
  }

  if (locked.categoryIds !== undefined) {
    if (locked.categoryIds.length > CATEGORY_CHIP_LIMIT) {
      chips.push(t("browser.categoriesChip", { count: locked.categoryIds.length }));
    } else {
      for (const id of locked.categoryIds) {
        chips.push(categoryName(id));
      }
    }
  }

  if (locked.merchant !== undefined) {
    const m = locked.merchant.trim();
    chips.push(m === "" ? t("browser.unknown") : m);
  }

  if (locked.dateRange) {
    // `to` is exclusive per the LockedFilters contract — subtract one day
    // for display so the chip reads as an inclusive range matching what the
    // analytics surface showed before the user drilled in.
    const inclusiveTo = new Date(locked.dateRange.to);
    inclusiveTo.setDate(inclusiveTo.getDate() - 1);
    chips.push(
      `${formatChipDate(locked.dateRange.from, locale)} – ${formatChipDate(inclusiveTo, locale)}`,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((label, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function TransactionsBrowser({
  transactions,
  lockedFilters,
  title,
  subtitle,
}: TransactionsBrowserProps) {
  const { t } = useTranslation("budget");
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const showSearch = transactions.length > SEARCH_THRESHOLD;

  // The search field unmounts when `showSearch === false`, so `search`
  // can't change in that branch. Gating the body keeps the search work
  // off the small-list path even if a previous render left `search`
  // non-empty (e.g. the underlying data shrank past the threshold).
  const filteredBySearch = useMemo(
    () =>
      showSearch
        ? searchTransactions(transactions, search, { accounts, categories })
        : transactions,
    [showSearch, transactions, search, accounts, categories],
  );
  const visible = useMemo(
    () => sortTransactions(filteredBySearch, sort, accounts, categories),
    [filteredBySearch, sort, accounts, categories],
  );

  const hasSearchQuery = search.trim().length > 0;
  const emptyFromSearch = hasSearchQuery && visible.length === 0;

  // Who owns the scroll decides who carries the styled `.list-scroll` gutter.
  // Below the virtualize threshold `TransactionList` renders a plain table and
  // this outer div is the scroller; at/above it the list wraps its own inner
  // scroller (which carries `.list-scroll`) and this div should stay plain —
  // otherwise both scroll and you get two reserved gutters side by side.
  const outerOwnsScroll = visible.length < VIRTUALIZE_THRESHOLD;

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold leading-none">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
        <FilterChips locked={lockedFilters} categories={categories} />
      </div>

      {/* Search (conditional) */}
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
          <Input
            type="text"
            placeholder={t("browser.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
            aria-label={t("browser.searchAria")}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label={t("browser.clearSearch")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* List — `overflow-auto` here handles the small-list (non-virtualized)
       *  case where `TransactionList` doesn't wrap in its own scroll container.
       *  In the virtualized branch the inner scroller's `calc(100dvh - 220px)`
       *  cap exceeds the modal's 80vh-minus-chrome budget, so this div scrolls
       *  too — harmless when invisible, but with a styled gutter on both it
       *  reads as two scrollbars. Gate the gutter on who actually owns the
       *  scroll (see `outerOwnsScroll`). */}
      <div
        className={`flex-1 min-h-0 overflow-auto ${outerOwnsScroll ? "list-scroll" : ""}`}
      >
        {emptyFromSearch ? (
          <EmptyState
            title={
              <>
                {t("browser.noMatch")}{" "}
                <code className="font-mono text-xs">{search}</code>
              </>
            }
          />
        ) : (
          <TransactionList
            transactions={visible}
            showAccountColumn
            sort={sort}
            onSortChange={setSort}
          />
        )}
      </div>
    </div>
  );
}
