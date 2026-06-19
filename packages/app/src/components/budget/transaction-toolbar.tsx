import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CategorySelector } from "@/components/budget/category-selector";
import { DateRangePicker } from "@/components/budget/date-range-picker";
import { TransactionFilterPopover } from "@/components/budget/transaction-filter-popover";
import { useTranslation } from "@capybudget/i18n";
import { useCategories } from "@/hooks/use-budget-data";
import {
  ALL_TRANSACTION_TYPES,
  hasActiveFilters,
  hasSecondaryFilters,
  type TransactionFilterCriteria,
} from "@/lib/filter-transactions";
import { ListFilter, Search, X } from "lucide-react";

export type { TransactionFilterCriteria as TransactionFilters };

interface TransactionToolbarProps {
  filters: TransactionFilterCriteria;
  onFiltersChange: (filters: TransactionFilterCriteria) => void;
}

const activeRing = "ring-1 ring-brand/30 rounded-lg";

export function TransactionToolbar({ filters, onFiltersChange }: TransactionToolbarProps) {
  const { t } = useTranslation("budget");
  const { data: categories = [] } = useCategories();

  const hasSearch = filters.search.length > 0;
  const hasCategory = filters.categoryId !== null;
  const hasDateRange = filters.dateRange !== null;
  const hasSecondary = hasSecondaryFilters(filters);

  const update = (patch: Partial<TransactionFilterCriteria>) =>
    onFiltersChange({ ...filters, ...patch });

  const clearAll = () =>
    onFiltersChange({
      search: "",
      categoryId: null,
      dateRange: null,
      merchant: undefined,
      types: [...ALL_TRANSACTION_TYPES],
      uncategorizedOnly: false,
      noMerchantOnly: false,
    });

  return (
    <div className="relative">
      {hasActiveFilters(filters) && (
        <Button
          variant="ghost"
          size="xs"
          onClick={clearAll}
          className="absolute bottom-full right-0 mb-0.5 text-muted-foreground"
          aria-label={t("toolbar.clearFilters")}
        >
          <X className="h-3 w-3" />
          <span>{t("toolbar.clear")}</span>
        </Button>
      )}

      <div className="flex items-center gap-2">
        <div className={`relative flex-[5] min-w-0 ${hasSearch ? activeRing : ""}`}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder={t("toolbar.search")}
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="pl-8 pr-8"
          />
          {hasSearch && (
            <button
              type="button"
              onClick={() => update({ search: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label={t("toolbar.clearSearch")}
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

        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="relative shrink-0"
                aria-label={t("toolbar.moreFilters")}
              />
            }
          >
            <ListFilter className="h-3.5 w-3.5" />
            {hasSecondary && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" />
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <TransactionFilterPopover filters={filters} update={update} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
