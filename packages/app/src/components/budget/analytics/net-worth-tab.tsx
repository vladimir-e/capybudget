import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  formatMoney,
  formatMoneyCompact,
  getNetWorthOverTime,
} from "@capybudget/core";
import type { Account, Transaction, DateRange } from "@capybudget/core";
import { ChartSwitcher } from "./chart-switcher";
import { useThemeColors } from "./use-theme-colors";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ── Tooltip ──

function NetWorthTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{formatMoney(payload[0].value)}</p>
    </div>
  );
}

// ── Main ──

interface NetWorthTabProps {
  accounts: Account[];
  transactions: Transaction[];
  dateRange: DateRange;
}

type ChartMode = "bar" | "area";

const CHART_OPTIONS: Array<{ value: ChartMode; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "area", label: "Area" },
];

export function NetWorthTab({ accounts, transactions, dateRange }: NetWorthTabProps) {
  const [chartMode, setChartMode] = useState<ChartMode>("bar");

  const netWorthData = useMemo(
    () => getNetWorthOverTime(accounts, transactions, dateRange),
    [accounts, transactions, dateRange],
  );

  const chartData = useMemo(
    () =>
      netWorthData.map((p) => {
        const d = new Date(p.date);
        return {
          label: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
          netWorth: p.netWorth,
        };
      }),
    [netWorthData],
  );

  const { brandColor, expenseColor } = useThemeColors({
    brandColor: ["--brand", "oklch(0.58 0.14 55)"],
    expenseColor: ["--amount-expense", "#ef4444"],
  });

  if (chartData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No data available
      </p>
    );
  }

  if (chartData.length === 1) {
    return (
      <div className="flex items-center justify-center h-[280px]">
        <div className="text-center">
          <div
            className="mx-auto h-4 w-4 rounded-full mb-2"
            style={{ backgroundColor: brandColor }}
          />
          <p className="text-lg font-semibold tabular-nums">
            {formatMoney(chartData[0].netWorth)}
          </p>
          <p className="text-xs text-muted-foreground">{chartData[0].label}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ChartSwitcher options={CHART_OPTIONS} value={chartMode} onChange={setChartMode} />
      </div>

      <ResponsiveContainer width="100%" height={320}>
        {chartMode === "bar" ? (
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyCompact(v)}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={65}
            />
            <Tooltip content={<NetWorthTooltipContent />} />
            <Bar dataKey="netWorth" radius={[1, 1, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell
                  key={i}
                  fill={entry.netWorth >= 0 ? brandColor : expenseColor}
                  fillOpacity={0.6}
                />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <defs>
              <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={brandColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={brandColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyCompact(v)}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={65}
            />
            <Tooltip content={<NetWorthTooltipContent />} />
            <Area
              type="monotone"
              dataKey="netWorth"
              stroke={brandColor}
              strokeWidth={2}
              fill="url(#netWorthFill)"
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
