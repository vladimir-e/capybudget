import { useTranslation } from "@capybudget/i18n";
import { useFormatMoney } from "@/contexts/currency-context";

interface SummaryStripProps {
  summary: { totalIncome: number; totalExpenses: number; net: number };
}

export function SummaryStrip({ summary }: SummaryStripProps) {
  const { format } = useFormatMoney();
  const { t } = useTranslation("analytics");
  return (
    <div className="flex items-center gap-6 rounded-lg border bg-card px-5 py-4">
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("summary.income")}
        </div>
        <div className="text-xl font-bold tabular-nums text-amount-income mt-0.5">
          {format(summary.totalIncome)}
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("summary.expenses")}
        </div>
        <div className="text-xl font-bold tabular-nums text-amount-expense mt-0.5">
          {format(Math.abs(summary.totalExpenses))}
        </div>
      </div>
      <div className="h-8 w-px bg-border" />
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("summary.net")}
        </div>
        <div
          className={`text-xl font-bold tabular-nums mt-0.5 ${
            summary.net >= 0 ? "text-amount-income" : "text-amount-expense"
          }`}
        >
          {summary.net >= 0 ? "+" : ""}
          {format(Math.abs(summary.net))}
        </div>
      </div>
    </div>
  );
}
