import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  formatMoney,
  formatMoneyCompact,
  getCategoryTrends,
} from "@capybudget/core";
import type { Transaction, Category, DateRange } from "@capybudget/core";
import { ChartSwitcher } from "./chart-switcher";

// ── Chart colors ──

const TREND_COLORS = [
  "oklch(0.55 0.14 55)",   // amber
  "oklch(0.50 0.14 30)",   // terracotta
  "oklch(0.58 0.10 85)",   // golden
  "oklch(0.52 0.12 290)",  // plum
  "oklch(0.55 0.08 250)",  // slate blue
  "oklch(0.60 0.14 15)",   // coral
  "oklch(0.48 0.10 60)",   // dark amber
  "oklch(0.58 0.12 340)",  // rose
];

// ── Tooltip ──

function TrendsTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md space-y-1">
      <p className="text-sm font-medium">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.dataKey}</span>
          <span className="tabular-nums font-medium ml-auto">
            {formatMoney(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main ──

interface TrendsTabProps {
  transactions: Transaction[];
  categories: Category[];
  dateRange: DateRange;
}

type ViewMode = "expense" | "income";

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string }> = [
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
];

export function TrendsTab({ transactions, categories, dateRange }: TrendsTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("expense");

  const trends = useMemo(
    () => getCategoryTrends(transactions, categories, dateRange, { type: viewMode, limit: 8 }),
    [transactions, categories, dateRange, viewMode],
  );

  // Transform for Recharts: { month, [categoryName]: cents, ... }
  const chartData = useMemo(() => {
    const nameById = new Map(trends.series.map((s) => [s.categoryId, s.categoryName]));
    return trends.points.map((point) => {
      const row: Record<string, string | number> = { month: point.month };
      for (const [catId, amt] of Object.entries(point.byCategory)) {
        const name = nameById.get(catId) ?? "Uncategorized";
        row[name] = amt;
      }
      return row;
    });
  }, [trends]);

  if (trends.points.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <ChartSwitcher options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
        </div>
        <p className="text-sm text-muted-foreground py-12 text-center">
          No trend data in this period
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ChartSwitcher options={VIEW_OPTIONS} value={viewMode} onChange={setViewMode} />
      </div>

      <ResponsiveContainer width="100%" height={360}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
          />
          <YAxis
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            width={65}
          />
          <Tooltip content={<TrendsTooltipContent />} />
          <Legend wrapperStyle={{ fontSize: "12px" }} />
          {trends.series.map((s, i) => (
            <Line
              key={s.categoryId}
              dataKey={s.categoryName}
              type="monotone"
              stroke={TREND_COLORS[i % TREND_COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
