import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  formatMoney,
  formatMoneyCompact,
  getTopMerchants,
} from "@capybudget/core";
import type { Transaction, DateRange } from "@capybudget/core";
import { useThemeColors } from "./use-theme-colors";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { normalizeMerchant } from "@/lib/filter-transactions";
import type { PeriodType } from "@/stores/analytics-store";
import { formatRangeLabel } from "./format-range";

// ── Tooltip ──

function MerchantTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { merchant: string; total: number; count: number; percentage: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover">
      <p className="text-sm font-medium">{data.merchant}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {formatMoney(data.total)} · {data.count} txn{data.count !== 1 ? "s" : ""} · {data.percentage.toFixed(1)}%
      </p>
    </div>
  );
}

// ── Main ──

interface MerchantsTabProps {
  transactions: Transaction[];
  dateRange: DateRange;
  periodType: PeriodType;
}

export function MerchantsTab({
  transactions,
  dateRange,
  periodType,
}: MerchantsTabProps) {
  const merchants = useMemo(
    () => getTopMerchants(transactions, 15),
    [transactions],
  );

  const [drilldown, setDrilldown] = useState<{ merchant: string } | null>(null);

  // Pre-filter to expenses for this merchant — mirrors getTopMerchants's
  // grouping (expenses only, case-insensitive whitespace-trimmed equality).
  const drilldownTransactions = useMemo(() => {
    if (!drilldown) return [];
    // `getTopMerchants` displays the synthetic "Unknown" bucket for empty
    // merchant strings — match those back here.
    const isUnknown = drilldown.merchant === "Unknown";
    const target = normalizeMerchant(drilldown.merchant);
    return transactions.filter((t) => {
      if (t.type !== "expense") return false;
      const norm = normalizeMerchant(t.merchant);
      return isUnknown ? norm === "" : norm === target;
    });
  }, [drilldown, transactions]);

  const handleMerchantClick = (merchant: string) => {
    setDrilldown({ merchant });
  };

  const { brandColor } = useThemeColors({
    brandColor: ["--brand", "oklch(0.58 0.14 55)"],
  });

  if (merchants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No merchant data in this period
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Horizontal bar chart */}
      <ResponsiveContainer width="100%" height={400}>
        <BarChart
          data={merchants}
          layout="vertical"
          margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatMoneyCompact(v)}
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
          />
          <YAxis
            type="category"
            dataKey="merchant"
            tick={{ fontSize: 12 }}
            className="text-muted-foreground"
            width={120}
          />
          <Tooltip content={<MerchantTooltipContent />} />
          <Bar
            dataKey="total"
            fill={brandColor}
            radius={[0, 4, 4, 0]}
            onClick={(d) => {
              const payload = (d as { payload?: { merchant?: string } }).payload;
              if (payload?.merchant) handleMerchantClick(payload.merchant);
            }}
            className="cursor-pointer"
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Ranked list */}
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
        {/* Header */}
        <span className="text-xs text-muted-foreground font-medium">#</span>
        <span className="text-xs text-muted-foreground font-medium">Merchant</span>
        <span className="text-xs text-muted-foreground font-medium text-right">Amount</span>
        <span className="text-xs text-muted-foreground font-medium text-right">Txns</span>
        <span className="text-xs text-muted-foreground font-medium text-right">%</span>

        {merchants.map((m, i) => (
          <div key={m.merchant} className="contents">
            <span className="tabular-nums text-muted-foreground">{i + 1}</span>
            <button
              type="button"
              onClick={() => handleMerchantClick(m.merchant)}
              className="text-foreground truncate text-left hover:text-brand hover:underline underline-offset-2 transition-colors cursor-pointer"
              aria-label={`View ${m.merchant} transactions`}
            >
              {m.merchant}
            </button>
            <span className="tabular-nums font-medium text-foreground text-right">
              {formatMoney(m.total)}
            </span>
            <span className="tabular-nums text-muted-foreground text-right">
              {m.count}
            </span>
            <span className="tabular-nums text-muted-foreground text-right">
              {m.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <TransactionsModal
        open={drilldown !== null}
        onOpenChange={(open) => !open && setDrilldown(null)}
        transactions={drilldownTransactions}
        lockedFilters={
          drilldown
            ? {
                merchant: drilldown.merchant === "Unknown" ? "" : drilldown.merchant,
                dateRange: { from: dateRange.start, to: dateRange.end },
              }
            : {}
        }
        title={drilldown?.merchant ?? ""}
        subtitle={
          drilldown
            ? `${formatRangeLabel(dateRange, periodType)} · ${drilldownTransactions.length} transaction${
                drilldownTransactions.length === 1 ? "" : "s"
              }`
            : undefined
        }
      />
    </div>
  );
}
