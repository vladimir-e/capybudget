import type { Category, CategoryGroup } from "@capybudget/core";
import type { BudgetRow } from "./monthly-budget-rows";
import { CategoryRow } from "./monthly-budget-category-row";

// ── Column header ────

/** Sticky labels above the rows — same grid as `CategoryRow` so columns line
 *  up with the data. */
export function ColumnHeader() {
  return (
    <div className="sticky top-0 z-10 bg-background border-b grid grid-cols-[minmax(0,1.4fr)_140px_120px_minmax(160px,2fr)_120px] gap-3 items-center px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
      <span>Category</span>
      <span className="text-right">Target</span>
      <span className="text-right">Spent</span>
      <span /> {/* bar column intentionally unlabelled */}
      <span className="text-right">Remaining</span>
    </div>
  );
}

// ── Group section ────

interface GroupSectionProps {
  group: CategoryGroup;
  categories: Category[];
  rowByCategory: Map<string, BudgetRow>;
  hideUntargeted: boolean;
  referenceLabel: string;
  onDrilldown: (category: Category) => void;
}

export function GroupSection({
  group,
  categories,
  rowByCategory,
  hideUntargeted,
  referenceLabel,
  onDrilldown,
}: GroupSectionProps) {
  const entries = categories.map((c) => ({
    category: c,
    row: rowByCategory.get(c.id),
  }));

  // An untargeted row with spend still says something ("Other Spending"), so
  // the filter only hides untargeted rows that are also empty — unless the
  // user explicitly asks to hide all untargeted, which collapses the noise to
  // the rows Capy is actually tracking.
  const visible = hideUntargeted
    ? entries.filter((e) => e.row && e.row.effectiveTarget !== null)
    : entries;

  if (visible.length === 0) return null;

  const totalCount = categories.length;
  const targetedCount = entries.reduce(
    (n, e) => n + (e.row && e.row.effectiveTarget !== null ? 1 : 0),
    0,
  );

  return (
    <div className="space-y-0.5">
      {/* Group header — title only, full width, no per-group subtotals. */}
      <div className="px-3 pt-3 pb-1.5 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {group}
          {targetedCount < totalCount && (
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground/60">
              {targetedCount}/{totalCount} tracked
            </span>
          )}
        </h3>
      </div>

      {/* Rows */}
      {visible.map(
        (e) =>
          e.row && (
            <CategoryRow
              key={e.category.id}
              category={e.category}
              row={e.row}
              referenceLabel={referenceLabel}
              onDrilldown={onDrilldown}
            />
          ),
      )}
    </div>
  );
}
