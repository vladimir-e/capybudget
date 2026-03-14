import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CategorySelector } from "@/components/budget/category-selector";
import { DateRangePicker } from "@/components/budget/date-range-picker";
import { useCategories } from "@/hooks/use-budget-data";
import type { TransactionFilterCriteria } from "@/lib/filter-transactions";
import { Search, X } from "lucide-react";

export type { TransactionFilterCriteria as TransactionFilters };

interface TransactionToolbarProps {
  filters: TransactionFilterCriteria;
  onFiltersChange: (filters: TransactionFilterCriteria) => void;
}

const activeRing = "ring-1 ring-brand/30 rounded-lg";

export function TransactionToolbar({ filters, onFiltersChange }: TransactionToolbarProps) {
  const { data: categories = [] } = useCategories();

  const hasSearch = filters.search.length > 0;
  const hasCategory = filters.categoryId !== null;
  const hasDateRange = filters.dateRange !== null;
  const hasActiveFilters = hasSearch || hasCategory || hasDateRange;

  const update = (patch: Partial<TransactionFilterCriteria>) =>
    onFiltersChange({ ...filters, ...patch });

  const clearAll = () =>
    onFiltersChange({ search: "", categoryId: null, dateRange: null });

  return (
    <div className="flex items-center gap-2">
      <div className={`relative flex-[5] min-w-0 ${hasSearch ? activeRing : ""}`}>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          placeholder="Search transactions…"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="pl-8 pr-8"
        />
        {hasSearch && (
          <button
            type="button"
            onClick={() => update({ search: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className={`flex-[3] min-w-0 [&>div]:w-full [&_button:first-of-type]:flex-1 [&_button:first-of-type]:min-w-0 ${hasCategory ? activeRing : ""}`}>
        <CategorySelector
          categories={categories}
          value={filters.categoryId}
          onChange={(id) => update({ categoryId: id })}
          includeAll
          clearable
        />
      </div>

      <div className={`flex-[3] min-w-0 [&>div]:w-full [&_button:first-of-type]:flex-1 [&_button:first-of-type]:min-w-0 ${hasDateRange ? activeRing : ""}`}>
        <DateRangePicker
          value={filters.dateRange}
          onChange={(range) => update({ dateRange: range })}
        />
      </div>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="xs"
          onClick={clearAll}
          className="shrink-0 text-muted-foreground"
          aria-label="Clear all filters"
        >
          <X className="h-3 w-3" />
          <span>Clear</span>
        </Button>
      )}
    </div>
  );
}
