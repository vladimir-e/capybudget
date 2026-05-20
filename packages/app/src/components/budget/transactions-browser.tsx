import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { Category, Transaction } from "@capybudget/core";
import { formatMoney } from "@capybudget/core";
import { Input } from "@/components/ui/input";
import { TransactionList } from "@/components/budget/transaction-list";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
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

// ---------------------------------------------------------------------------
// Local search — substring match across every column the user sees in the
// table: merchant, category, account, note, amount. Intentionally narrower
// than `filterTransactions` in that it doesn't carry sort/date/category
// state — this is the local feel of a popup, not the full toolbar.
// ---------------------------------------------------------------------------

function matchesAmount(cents: number, q: string): boolean {
  const formatted = formatMoney(cents).toLowerCase();
  if (formatted.includes(q)) return true;
  const plain = formatted.replace(/,/g, "");
  if (plain.includes(q)) return true;
  const noCurrency = plain.replace("$", "");
  return noCurrency.includes(q);
}

function searchTransactions(
  transactions: Transaction[],
  query: string,
  categoryMap: Map<string, string>,
  accountMap: Map<string, string>,
): Transaction[] {
  const q = query.trim().toLowerCase();
  if (!q) return transactions;
  return transactions.filter((t) => {
    if (t.merchant.toLowerCase().includes(q)) return true;
    if (t.note.toLowerCase().includes(q)) return true;
    if (categoryMap.get(t.categoryId)?.includes(q)) return true;
    if (accountMap.get(t.accountId)?.includes(q)) return true;
    if (matchesAmount(t.amount, q)) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
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
  const chips: string[] = [];

  if (locked.categoryId !== undefined) {
    const cat = categories.find((c) => c.id === locked.categoryId);
    chips.push(cat?.name ?? "Uncategorized");
  }

  if (locked.merchant !== undefined) {
    const m = locked.merchant.trim();
    chips.push(m === "" ? "Unknown" : m);
  }

  if (locked.dateRange) {
    // `to` is exclusive per the LockedFilters contract — subtract one day
    // for display so the chip reads as an inclusive range matching what the
    // analytics surface showed before the user drilled in.
    const inclusiveTo = new Date(locked.dateRange.to);
    inclusiveTo.setDate(inclusiveTo.getDate() - 1);
    chips.push(
      `${formatDateLabel(locked.dateRange.from)} – ${formatDateLabel(inclusiveTo)}`,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((label) => (
        <span
          key={label}
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
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>(DEFAULT_SORT);

  const showSearch = transactions.length > SEARCH_THRESHOLD;

  const categoryMap = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
    // The transaction list renders missing `categoryId` as "Uncategorized" —
    // mirror that here so typing "uncategorized" in the search matches.
    m.set("", "uncategorized");
    return m;
  }, [categories]);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name.toLowerCase()])),
    [accounts],
  );

  // The search field unmounts when `showSearch === false`, so `search`
  // can't change in that branch. Gating the body keeps the search work
  // off the small-list path even if a previous render left `search`
  // non-empty (e.g. the underlying data shrank past the threshold).
  const filteredBySearch = useMemo(
    () =>
      showSearch
        ? searchTransactions(transactions, search, categoryMap, accountMap)
        : transactions,
    [showSearch, transactions, search, categoryMap, accountMap],
  );
  const visible = useMemo(
    () => sortTransactions(filteredBySearch, sort, accounts, categories),
    [filteredBySearch, sort, accounts, categories],
  );

  const hasSearchQuery = search.trim().length > 0;
  const emptyFromSearch = hasSearchQuery && visible.length === 0;

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
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm"
            aria-label="Search transactions"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* List — `overflow-auto` here handles the small-list (non-virtualized)
       *  case where `TransactionList` doesn't wrap in its own scroll
       *  container. The virtualized branch has its own inner scroller capped
       *  at `calc(100vh - 220px)`, which is comfortably larger than the
       *  modal's 80vh budget minus chrome, so the inner cap effectively
       *  defers to the parent flex height in modal context. */}
      <div className="flex-1 min-h-0 overflow-auto">
        {emptyFromSearch ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No transactions match <code className="font-mono text-xs">{search}</code>
          </p>
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
