import { useTranslation } from "@capybudget/i18n";
import { TransactionsDrilldownLink } from "@/components/budget/transactions-drilldown-link";

export interface KPICard {
  label: string;
  /** Pre-formatted display value (money, a count, etc.). */
  display: string;
  /** Optional noun trailing the value so a bare count reads as a thing —
   *  e.g. "3" + "categories". Rendered smaller and muted; the value stays hero. */
  unit?: string;
  tone?: "default" | "income" | "expense";
  /** When set, the value renders as a drilldown link that opens the
   *  transactions browser for whatever scope this card represents. */
  onClick?: () => void;
}

export function KpiStrip({ cards }: { cards: KPICard[] }) {
  const { t } = useTranslation("analytics");
  return (
    <div className="grid grid-cols-3 gap-3">
      {cards.map((c) => {
        const toneClass =
          c.tone === "income"
            ? "text-amount-income"
            : c.tone === "expense"
              ? "text-amount-expense"
              : "text-foreground";
        const valueClass = `text-xl font-bold tabular-nums mt-1 ${toneClass}`;
        return (
          <div key={c.label} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {c.label}
            </div>
            <div className={valueClass}>
              {c.onClick ? (
                <TransactionsDrilldownLink
                  onClick={c.onClick}
                  ariaLabel={t("a11y.viewTransactionsAria", { name: c.label })}
                >
                  {c.display}
                </TransactionsDrilldownLink>
              ) : (
                c.display
              )}
              {c.unit ? (
                <span className="ml-1.5 text-sm font-medium text-muted-foreground">
                  {c.unit}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
