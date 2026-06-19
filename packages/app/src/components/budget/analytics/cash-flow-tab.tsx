import { useMemo } from "react";
import { useThemeColors } from "./use-theme-colors";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  ensureMinMonths,
  getCashFlow,
} from "@capybudget/core";
import type { Transaction, DateRange } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";
import { EmptyState } from "@/components/ui/empty-state";

// ── Tooltip ──

function CashFlowTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  const { format } = useFormatMoney();
  const { t } = useTranslation("analytics");
  if (!active || !payload?.length) return null;

  const income = payload.find((p) => p.dataKey === "income")?.value ?? 0;
  const expenses = payload.find((p) => p.dataKey === "expenses")?.value ?? 0;
  const net = income - expenses;

  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm text-amount-income tabular-nums">
        {t("cashFlow.incomeValue", { value: format(income) })}
      </p>
      <p className="text-sm text-amount-expense tabular-nums">
        {t("cashFlow.expensesValue", { value: format(expenses) })}
      </p>
      <p className={`text-sm font-medium tabular-nums ${net >= 0 ? "text-amount-income" : "text-amount-expense"}`}>
        {t("cashFlow.netValue", { value: `${net >= 0 ? "+" : ""}${format(Math.abs(net))}` })}
      </p>
    </div>
  );
}

// ── Main ──

interface CashFlowTabProps {
  transactions: Transaction[];
  dateRange: DateRange;
  hasAnyTransactions: boolean;
}

export function CashFlowTab({ transactions, dateRange, hasAnyTransactions }: CashFlowTabProps) {
  const { formatCompact } = useFormatMoney();
  const { t } = useTranslation("analytics");
  const cashFlowData = useMemo(
    () => getCashFlow(transactions, ensureMinMonths(dateRange, 12)),
    [transactions, dateRange],
  );

  const { incomeColor, expenseColor } = useThemeColors({
    incomeColor: ["--amount-income", "#22c55e"],
    expenseColor: ["--amount-expense", "#ef4444"],
  });

  if (cashFlowData.length === 0) {
    return (
      <EmptyState
        title={hasAnyTransactions ? t("cashFlow.empty") : t("empty.noDataYet")}
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={cashFlowData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis
          tickFormatter={(v: number) => formatCompact(v)}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
          width={65}
        />
        <Tooltip content={<CashFlowTooltipContent />} />
        <Legend
          wrapperStyle={{ fontSize: "12px" }}
        />
        <Bar
          dataKey="income"
          name={t("summary.income")}
          fill={incomeColor}
          radius={[4, 4, 0, 0]}
        >
          {cashFlowData.map((d, i) => (
            <Cell key={i} fill={d.income >= 0 ? incomeColor : expenseColor} />
          ))}
        </Bar>
        <Bar
          dataKey="expenses"
          name={t("summary.expenses")}
          fill={expenseColor}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
