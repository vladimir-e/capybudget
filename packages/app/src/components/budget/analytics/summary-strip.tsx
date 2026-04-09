import { formatMoney } from "@capybudget/core";

interface SummaryStripProps {
  summary: { totalIncome: number; totalExpenses: number; net: number };
}

export function SummaryStrip({ summary }: SummaryStripProps) {
  return (
    <div className="flex items-center gap-6 rounded-lg border bg-card px-5 py-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Income
        </div>
        <div className="text-xl font-bold tabular-nums text-amount-income mt-0.5">
          {formatMoney(summary.totalIncome)}
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Expenses
        </div>
        <div className="text-xl font-bold tabular-nums text-amount-expense mt-0.5">
          {formatMoney(Math.abs(summary.totalExpenses))}
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Net
        </div>
        <div
          className={`text-xl font-bold tabular-nums mt-0.5 ${
            summary.net >= 0 ? "text-amount-income" : "text-amount-expense"
          }`}
        >
          {summary.net >= 0 ? "+" : ""}
          {formatMoney(Math.abs(summary.net))}
        </div>
      </div>
    </div>
  );
}
