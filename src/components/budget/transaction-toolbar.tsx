import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CategorySelector } from "@/components/budget/category-selector";
import { DateRangePicker, type DateRangeValue } from "@/components/budget/date-range-picker";
import type { Category } from "@/lib/types";
import { Search, X } from "lucide-react";

interface TransactionToolbarProps {
  categories: Category[];
}

export function TransactionToolbar({ categories }: TransactionToolbarProps) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue | null>(null);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 pr-8"
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

      <CategorySelector
        categories={categories}
        value={categoryId}
        onChange={setCategoryId}
        includeAll
        clearable
      />

      <DateRangePicker value={dateRange} onChange={setDateRange} />
    </div>
  );
}
