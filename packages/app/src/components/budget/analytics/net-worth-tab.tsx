import { useDeferredValue, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ensureMinMonths,
  getNetWorthOverTime,
  getNetWorthBreakdown,
} from "@capybudget/core";
import type { Account, Transaction, DateRange } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useConverter, useCurrency } from "@/contexts/currency-context";
import { useFormatters } from "@/hooks/use-formatters";
import { ChartSwitcher } from "./chart-switcher";
import { useThemeColors } from "./use-theme-colors";
import { NetWorthAccountFilter } from "./net-worth-account-filter";
import { NetWorthFxCallout } from "./net-worth-fx-callout";
import { computeIncludedIds } from "./net-worth-account-filter-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnalyticsStore } from "@/stores/analytics-store";

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
  const { money } = useFormatters();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{money(payload[0].value)}</p>
    </div>
  );
}

// ── Main ──

interface NetWorthTabProps {
  accounts: Account[];
  transactions: Transaction[];
  dateRange: DateRange;
  hasAnyTransactions: boolean;
}

type ChartMode = "bar" | "area";

export function NetWorthTab({ accounts, transactions, dateRange, hasAnyTransactions }: NetWorthTabProps) {
  const { money, moneyCompact, monthShort } = useFormatters();
  const { t } = useTranslation("analytics");
  const converter = useConverter();
  const defaultCurrency = useCurrency();
  const [chartMode, setChartMode] = useState<ChartMode>("bar");

  const chartOptions: Array<{ value: ChartMode; label: string }> = [
    { value: "bar", label: t("netWorth.bar") },
    { value: "area", label: t("netWorth.area") },
  ];
  const netWorthExcludedIds = useAnalyticsStore((s) => s.netWorthExcludedIds);
  const setNetWorthExcludedIds = useAnalyticsStore((s) => s.setNetWorthExcludedIds);

  const includedIds = useMemo(
    () => computeIncludedIds(accounts, netWorthExcludedIds),
    [accounts, netWorthExcludedIds],
  );

  // Defer heavy inputs so the tab shell renders immediately
  const deferredTransactions = useDeferredValue(transactions);
  const deferredRange = useDeferredValue(dateRange);
  const deferredIncludedIds = useDeferredValue(includedIds);
  const isStale =
    deferredTransactions !== transactions ||
    deferredRange !== dateRange ||
    deferredIncludedIds !== includedIds;

  // The chart's actual window — the cost-basis line clamps to this end.
  const chartRange = useMemo(() => ensureMinMonths(deferredRange, 12), [deferredRange]);

  const netWorthData = useMemo(
    () =>
      getNetWorthOverTime(
        accounts,
        deferredTransactions,
        chartRange,
        deferredIncludedIds,
        converter,
      ),
    [accounts, deferredTransactions, chartRange, deferredIncludedIds, converter],
  );

  // The FX callout sits under the chart, so its cost basis must equal the
  // chart's endpoint: same include-set, same transactions clamped to the same
  // window end. Then `current value (spot) = cost basis (chart endpoint) +
  // unrealized FX` reads true. Spot is a today's-rate number, so it's only
  // honest while the window reaches the present — scrub to a historical range
  // and the callout hides (we have no spot at a past date). A USD-only budget
  // has no foreign account, so nothing renders.
  const includedAccounts = useMemo(
    () => accounts.filter((a) => deferredIncludedIds.has(a.id)),
    [accounts, deferredIncludedIds],
  );
  const hasForeignAccount = includedAccounts.some((a) => a.currency !== defaultCurrency);
  // Captured once at mount: a stable "now" keeps the render pure, and the gate is
  // month-coarse so mount-time drift never matters.
  const [now] = useState(() => Date.now());
  const rangeIsCurrent = chartRange.end.getTime() > now;
  const fxBreakdown = useMemo(
    () =>
      getNetWorthBreakdown(
        includedAccounts,
        deferredTransactions.filter((t) => new Date(t.datetime).getTime() < chartRange.end.getTime()),
        converter,
      ),
    [includedAccounts, deferredTransactions, chartRange, converter],
  );

  const chartData = useMemo(
    () =>
      netWorthData.map((p) => {
        const d = new Date(p.date);
        return {
          label: t("netWorth.monthLabel", {
            month: monthShort(d),
            year: d.getFullYear(),
          }),
          netWorth: p.netWorth,
        };
      }),
    [netWorthData, monthShort, t],
  );

  const yDomain = useMemo<[number | "auto", number | "auto"]>(() => {
    if (chartData.length === 0) return ["auto", "auto"];
    let min = Infinity;
    let max = -Infinity;
    for (const { netWorth } of chartData) {
      if (netWorth < min) min = netWorth;
      if (netWorth > max) max = netWorth;
    }
    return [Math.min(0, min), Math.max(0, max)];
  }, [chartData]);

  const { brandColor, expenseColor } = useThemeColors({
    brandColor: ["--brand", "oklch(0.58 0.14 55)"],
    expenseColor: ["--amount-expense", "#ef4444"],
  });

  const noAccountsSelected = includedIds.size === 0;

  const header = (
    <div className="flex justify-between">
      <NetWorthAccountFilter
        accounts={accounts}
        excludedIds={netWorthExcludedIds}
        onChange={setNetWorthExcludedIds}
      />
      <ChartSwitcher options={chartOptions} value={chartMode} onChange={setChartMode} />
    </div>
  );

  if (noAccountsSelected) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          title={t("netWorth.noAccountsTitle")}
          description={t("netWorth.noAccountsDescription")}
        />
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState title={hasAnyTransactions ? t("netWorth.noData") : t("empty.noDataYet")} />
      </div>
    );
  }

  if (chartData.length === 1) {
    return (
      <div className="space-y-4">
        {header}
        <div className="flex items-center justify-center h-[280px]">
          <div className="text-center">
            <div
              className="mx-auto h-4 w-4 rounded-full mb-2"
              style={{ backgroundColor: brandColor }}
            />
            <p className="text-lg font-semibold tabular-nums">
              {money(chartData[0].netWorth)}
            </p>
            <p className="text-xs text-muted-foreground">{chartData[0].label}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 transition-opacity duration-150 ${isStale ? "opacity-60" : ""}`}>
      {header}

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
              domain={yDomain}
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={65}
            />
            <ReferenceLine y={0} strokeDasharray="3 3" strokeOpacity={0.5} className="stroke-muted-foreground" />
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
              domain={yDomain}
              tickFormatter={(v: number) => moneyCompact(v)}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={65}
            />
            <ReferenceLine y={0} strokeDasharray="3 3" strokeOpacity={0.5} className="stroke-muted-foreground" />
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

      {hasForeignAccount && rangeIsCurrent && <NetWorthFxCallout breakdown={fxBreakdown} />}
    </div>
  );
}
