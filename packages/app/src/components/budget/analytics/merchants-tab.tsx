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
  getTopMerchants,
} from "@capybudget/core";
import type { Transaction, DateRange } from "@capybudget/core";
import { useFormatMoney } from "@/contexts/currency-context";
import { useThemeColors } from "./use-theme-colors";
import { EmptyState } from "@/components/ui/empty-state";
import { NO_DATA_YET } from "./empty-copy";
import { TransactionsModal } from "@/components/budget/transactions-modal";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";
import type { PeriodType } from "@/stores/analytics-store";
import { formatDrilldownSubtitle } from "./format-range";
import { getRechartsPayload } from "./recharts-payload";
import {
  matchesTarget,
  targetForRow,
  type MerchantDrilldownTarget,
} from "./merchant-drilldown";

// ── Tooltip ──

function MerchantTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { merchant: string; total: number; count: number; percentage: number } }>;
}) {
  const { format } = useFormatMoney();
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover">
      <p className="text-sm font-medium">{data.merchant}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {format(data.total)} · {data.count} txn{data.count !== 1 ? "s" : ""} · {data.percentage.toFixed(1)}%
      </p>
    </div>
  );
}

// ── Main ──

interface MerchantsTabProps {
  transactions: Transaction[];
  dateRange: DateRange;
  periodType: PeriodType;
  hasAnyTransactions: boolean;
}

export function MerchantsTab({
  transactions,
  dateRange,
  periodType,
  hasAnyTransactions,
}: MerchantsTabProps) {
  const { format, formatCompact } = useFormatMoney();
  const merchants = useMemo(
    () => getTopMerchants(transactions, 15),
    [transactions],
  );

  const [drilldown, setDrilldown] = useState<MerchantDrilldownTarget | null>(null);

  // Pre-filter to expenses for this merchant — mirrors getTopMerchants's
  // grouping (expenses only, case-insensitive whitespace-trimmed equality).
  const drilldownTransactions = useMemo(() => {
    if (!drilldown) return [];
    return transactions.filter(
      (t) => t.type === "expense" && matchesTarget(t.merchant, drilldown),
    );
  }, [drilldown, transactions]);

  /** Open the drilldown for a row of the merchants list. The row's own
   *  `isUnknown` flag (from `getTopMerchants`) is the source of truth —
   *  do not compare display strings. */
  const handleMerchantClick = (row: { merchant: string; isUnknown: boolean }) => {
    setDrilldown(targetForRow(row));
  };

  const { brandColor } = useThemeColors({
    brandColor: ["--brand", "oklch(0.58 0.14 55)"],
  });

  if (merchants.length === 0) {
    return (
      <EmptyState title={hasAnyTransactions ? "No merchant data in this period" : NO_DATA_YET} />
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
            tickFormatter={(v: number) => formatCompact(v)}
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
              const payload = getRechartsPayload<{ merchant?: string; isUnknown?: boolean }>(d);
              if (payload?.merchant !== undefined && payload.isUnknown !== undefined) {
                handleMerchantClick({ merchant: payload.merchant, isUnknown: payload.isUnknown });
              }
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
          // Two rows can share the display name "Unknown" (synthetic empty
          // bucket + a real merchant literally named "Unknown") — disambiguate
          // the React key with the `isUnknown` flag.
          <div key={`${m.merchant}|${m.isUnknown ? "u" : "n"}`} className="contents">
            <span className="tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="truncate">
              <TransactionsDrilldownLink
                onClick={() => handleMerchantClick(m)}
                ariaLabel={`View ${m.merchant} transactions`}
              >
                {m.merchant}
              </TransactionsDrilldownLink>
            </span>
            <span className="tabular-nums font-medium text-foreground text-right">
              {format(m.total)}
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
                // Empty string in the criteria maps to the empty-merchant
                // bucket via `normalizeMerchant`; non-empty maps to the
                // named merchant. The `kind` discriminator above guarantees
                // these two paths don't collide on a real "Unknown" merchant.
                merchant: drilldown.kind === "unknown" ? "" : drilldown.value,
                dateRange: { from: dateRange.start, to: dateRange.end },
              }
            : {}
        }
        title={drilldown?.kind === "unknown" ? "Unknown" : (drilldown?.value ?? "")}
        subtitle={drilldown ? formatDrilldownSubtitle(dateRange, periodType, drilldownTransactions, format) : undefined}
      />
    </div>
  );
}
