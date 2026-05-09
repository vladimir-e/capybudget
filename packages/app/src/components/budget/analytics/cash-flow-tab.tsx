import { useMemo } from "react";
import { useThemeColors } from "./use-theme-colors";
import {
  BarChart,
  Bar,
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
  getCashFlow,
} from "@capybudget/core";
import type { Transaction, DateRange } from "@capybudget/core";

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
  if (!active || !payload?.length) return null;

  const income = payload.find((p) => p.dataKey === "income")?.value ?? 0;
  const expenses = payload.find((p) => p.dataKey === "expenses")?.value ?? 0;
  const net = income - expenses;

  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-popover space-y-1">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-sm text-amount-income tabular-nums">
        Income: {formatMoney(income)}
      </p>
      <p className="text-sm text-amount-expense tabular-nums">
        Expenses: {formatMoney(expenses)}
      </p>
      <p className={`text-sm font-medium tabular-nums ${net >= 0 ? "text-amount-income" : "text-amount-expense"}`}>
        Net: {net >= 0 ? "+" : ""}{formatMoney(Math.abs(net))}
      </p>
    </div>
  );
}

// ── Main ──

interface CashFlowTabProps {
  transactions: Transaction[];
  dateRange: DateRange;
}

export function CashFlowTab({ transactions, dateRange }: CashFlowTabProps) {
  const cashFlowData = useMemo(
    () => getCashFlow(transactions, dateRange),
    [transactions, dateRange],
  );

  const { incomeColor, expenseColor } = useThemeColors({
    incomeColor: ["--amount-income", "#22c55e"],
    expenseColor: ["--amount-expense", "#ef4444"],
  });

  if (cashFlowData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No cash flow data in this period
      </p>
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
          tickFormatter={(v: number) => formatMoneyCompact(v)}
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
          name="Income"
          fill={incomeColor}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="expenses"
          name="Expenses"
          fill={expenseColor}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
