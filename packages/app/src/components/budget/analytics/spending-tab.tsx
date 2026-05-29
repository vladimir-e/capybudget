import { useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  formatMoney,
  getSpendingByCategory,
  getIncomeByCategory,
} from "@capybudget/core";
import type { Transaction, Category, DateRange } from "@capybudget/core";
import { ChartSwitcher } from "./chart-switcher";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";
import type { PeriodType } from "@/stores/analytics-store";
import { formatDrilldownSubtitle } from "./format-range";
import { getRechartsPayload } from "./recharts-payload";
import {
  buildSliceDrilldown,
  filterForSliceDrilldown,
  type SliceDrilldown,
  type SpendingViewMode,
} from "./spending-drilldown";

// ── Chart colors ──

// Expense palette: warm/earthy tones, no greens
const EXPENSE_COLORS = [
  "oklch(0.55 0.14 55)",   // amber
  "oklch(0.50 0.14 30)",   // terracotta
  "oklch(0.58 0.10 85)",   // golden
  "oklch(0.52 0.12 290)",  // plum
  "oklch(0.55 0.08 250)",  // slate blue
  "oklch(0.60 0.14 15)",   // coral
  "oklch(0.48 0.10 60)",   // dark amber
  "oklch(0.58 0.12 340)",  // rose
  "oklch(0.50 0.06 200)",  // steel
  "oklch(0.62 0.10 70)",   // sand
  "oklch(0.45 0.12 310)",  // deep purple
  "oklch(0.55 0.10 45)",   // bronze
  "oklch(0.50 0.08 230)",  // blue gray
  "oklch(0.58 0.14 5)",    // red-orange
  "oklch(0.52 0.06 180)",  // teal gray
];

// Income palette: shades of green
const INCOME_COLORS = [
  "oklch(0.52 0.14 152)",  // forest green
  "oklch(0.60 0.12 160)",  // jade
  "oklch(0.48 0.12 140)",  // dark green
  "oklch(0.55 0.10 170)",  // sea green
  "oklch(0.65 0.10 145)",  // light sage
  "oklch(0.50 0.08 130)",  // olive
  "oklch(0.58 0.14 165)",  // emerald
  "oklch(0.45 0.10 150)",  // deep forest
];

// ── Tooltip ──

function PieTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; percentage: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover">
      <p className="text-sm font-medium">{data.name}</p>
      <p className="text-sm text-muted-foreground">
        {formatMoney(data.value)} ({data.percentage.toFixed(1)}%)
      </p>
    </div>
  );
}

// ── Main ──

interface SpendingTabProps {
  transactions: Transaction[];
  categories: Category[];
  dateRange: DateRange;
  periodType: PeriodType;
}

type ViewMode = SpendingViewMode;

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "expenses", label: "Expenses" },
  { value: "income", label: "Income" },
];

export function SpendingTab({
  transactions,
  categories,
  dateRange,
  periodType,
}: SpendingTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("expenses");
  const [drilldown, setDrilldown] = useState<SliceDrilldown | null>(null);

  const spending = useMemo(
    () => getSpendingByCategory(transactions, categories),
    [transactions, categories],
  );

  const income = useMemo(
    () => getIncomeByCategory(transactions, categories),
    [transactions, categories],
  );

  const breakdown = viewMode === "expenses" ? spending : income;
  const palette = viewMode === "expenses" ? EXPENSE_COLORS : INCOME_COLORS;

  const chartData = useMemo(
    () =>
      breakdown.map((s) => ({
        categoryId: s.categoryId,
        name: s.categoryName,
        value: s.total,
        percentage: s.percentage,
      })),
    [breakdown],
  );

  const emptyMessage = viewMode === "expenses"
    ? "No expenses in this period"
    : "No income in this period";

  // Pre-filtered transactions for the active drilldown — the same `type`
  // gating `breakdown` produces (expense or income), then by categoryId.
  const drilldownTransactions = useMemo(
    () => (drilldown ? filterForSliceDrilldown(transactions, drilldown) : []),
    [drilldown, transactions],
  );

  const handleSliceClick = (data: { categoryId: string; name: string }) => {
    setDrilldown(buildSliceDrilldown(data, viewMode));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ChartSwitcher options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
      </div>

      {chartData.length > 0 ? (
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* Pie chart */}
          <div className="w-full md:w-1/2 shrink-0">
            <ResponsiveContainer width="100%" height={380}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={140}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(e) => {
                    const data = getRechartsPayload<{ categoryId: string; name: string }>(e);
                    if (data?.categoryId !== undefined) handleSliceClick(data);
                  }}
                  className="cursor-pointer"
                >
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={palette[i % palette.length]} />
                  ))}
                </Pie>
                <Tooltip content={<PieTooltipContent />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Breakdown list — grid keeps columns aligned. The amount in
           *  the third column is a drilldown link with the same behavior
           *  as clicking the corresponding pie slice — gives users with
           *  thin slices a fatter click target. */}
          <div className="grid grid-cols-[auto_auto_auto_auto] gap-x-2.5 gap-y-1.5 items-center pt-2">
            {chartData.map((entry, i) => (
              <div key={entry.name} className="contents text-sm">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: palette[i % palette.length] }}
                />
                <span className="whitespace-nowrap text-foreground">
                  {entry.name}
                </span>
                <span className="tabular-nums text-sm font-medium text-foreground text-right pl-4">
                  <TransactionsDrilldownLink
                    onClick={() => handleSliceClick(entry)}
                    ariaLabel={`View ${entry.name} transactions`}
                  >
                    {formatMoney(entry.value)}
                  </TransactionsDrilldownLink>
                </span>
                <span className="tabular-nums text-xs text-muted-foreground text-right">
                  {entry.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {emptyMessage}
        </p>
      )}

      <TransactionsModal
        open={drilldown !== null}
        onOpenChange={(open) => !open && setDrilldown(null)}
        transactions={drilldownTransactions}
        lockedFilters={
          drilldown
            ? {
                categoryId: drilldown.categoryId,
                dateRange: { from: dateRange.start, to: dateRange.end },
              }
            : {}
        }
        title={drilldown?.categoryName ?? ""}
        subtitle={drilldown ? formatDrilldownSubtitle(dateRange, periodType, drilldownTransactions) : undefined}
      />
    </div>
  );
}
