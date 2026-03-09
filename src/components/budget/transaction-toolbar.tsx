import { Input } from "@/components/ui/input";
import { CategorySelector } from "@/components/budget/category-selector";
import { DateRangePicker, type DateRangeValue } from "@/components/budget/date-range-picker";
import { useBudget } from "@/contexts/budget-context";
import { Search, X } from "lucide-react";

export interface TransactionFilters {
  search: string;
  categoryId: string | null;
  dateRange: DateRangeValue | null;
}

interface TransactionToolbarProps {
  filters: TransactionFilters;
  onFiltersChange: (filters: TransactionFilters) => void;
}

export function TransactionToolbar({ filters, onFiltersChange }: TransactionToolbarProps) {
  const { categories } = useBudget();

  const update = (patch: Partial<TransactionFilters>) =>
    onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-[5] min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          placeholder="Search transactions…"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="pl-8 pr-8"
        />
        {filters.search && (
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

      <div className="flex-[3] min-w-0 [&>div]:w-full [&_button:first-of-type]:flex-1 [&_button:first-of-type]:min-w-0">
        <CategorySelector
          categories={categories}
          value={filters.categoryId}
          onChange={(id) => update({ categoryId: id })}
          includeAll
          clearable
        />
      </div>

      <div className="flex-[3] min-w-0 [&>div]:w-full [&_button:first-of-type]:flex-1 [&_button:first-of-type]:min-w-0">
        <DateRangePicker
          value={filters.dateRange}
          onChange={(range) => update({ dateRange: range })}
        />
      </div>
    </div>
  );
}
