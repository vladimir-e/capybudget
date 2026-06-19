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
import { useLocale, useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { useFormatPercent } from "@/lib/format-percent";
import { useThemeColors } from "./use-theme-colors";
import { EmptyState } from "@/components/ui/empty-state";
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

interface MerchantRow {
  merchant: string;
  displayMerchant: string;
  total: number;
  count: number;
  percentage: number;
  isUnknown: boolean;
}

// ── Tooltip ──

function MerchantTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: MerchantRow }>;
}) {
  const { format } = useFormatMoney();
  const { t } = useTranslation("analytics");
  const formatPercent = useFormatPercent();
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover">
      <p className="text-sm font-medium">{data.displayMerchant}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {format(data.total)} · {t("merchants.txnCount", { count: data.count })} · {formatPercent(data.percentage)}
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
  const locale = useLocale();
  const { t } = useTranslation("analytics");
  const formatPercent = useFormatPercent();
  const merchants = useMemo<MerchantRow[]>(
    () =>
      getTopMerchants(transactions, 15).map((m) => ({
        ...m,
        displayMerchant: m.isUnknown ? t("fallback.unknown") : m.merchant,
      })),
    [transactions, t],
  );

  const [drilldown, setDrilldown] = useState<MerchantDrilldownTarget | null>(null);

  // Pre-filter to expenses for this merchant — mirrors getTopMerchants's
  // grouping (expenses only, case-insensitive whitespace-trimmed equality).
  const drilldownTransactions = useMemo(() => {
    if (!drilldown) return [];
    return transactions.filter(
      (tx) => tx.type === "expense" && matchesTarget(tx.merchant, drilldown),
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
      <EmptyState title={hasAnyTransactions ? t("merchants.empty") : t("empty.noDataYet")} />
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
            dataKey="displayMerchant"
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
        <span className="text-xs text-muted-foreground font-medium">{t("merchants.headerRank")}</span>
        <span className="text-xs text-muted-foreground font-medium">{t("merchants.headerMerchant")}</span>
        <span className="text-xs text-muted-foreground font-medium text-right">{t("merchants.headerAmount")}</span>
        <span className="text-xs text-muted-foreground font-medium text-right">{t("merchants.headerTxns")}</span>
        <span className="text-xs text-muted-foreground font-medium text-right">{t("merchants.headerPercent")}</span>

        {merchants.map((m, i) => (
          // Two rows can share the display name "Unknown" (synthetic empty
          // bucket + a real merchant literally named "Unknown") — disambiguate
          // the React key with the `isUnknown` flag.
          <div key={`${m.merchant}|${m.isUnknown ? "u" : "n"}`} className="contents">
            <span className="tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="truncate">
              <TransactionsDrilldownLink
                onClick={() => handleMerchantClick(m)}
                ariaLabel={t("a11y.viewTransactionsAria", { name: m.displayMerchant })}
              >
                {m.displayMerchant}
              </TransactionsDrilldownLink>
            </span>
            <span className="tabular-nums font-medium text-foreground text-right">
              {format(m.total)}
            </span>
            <span className="tabular-nums text-muted-foreground text-right">
              {m.count}
            </span>
            <span className="tabular-nums text-muted-foreground text-right">
              {formatPercent(m.percentage)}
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
        title={drilldown?.kind === "unknown" ? t("fallback.unknown") : (drilldown?.value ?? "")}
        subtitle={drilldown ? formatDrilldownSubtitle(dateRange, periodType, drilldownTransactions, format, locale, t) : undefined}
      />
    </div>
  );
}
