import type { NetWorthBreakdown } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatters } from "@/hooks/use-formatters";

interface NetWorthFxCalloutProps {
  breakdown: NetWorthBreakdown;
}

/** The unrealized FX gain/loss: the gap between a foreign account's cost basis
 *  (flows valued at the rates stamped when they happened) and its spot value
 *  (today's rate). Makes the headline relationship legible —
 *  `current value = cost basis + unrealized FX` — so the spot net worth and the
 *  cost-basis over-time chart don't silently disagree. Rendered only when a
 *  foreign account exists; the delta itself may still be 0 if rates haven't
 *  moved. */
export function NetWorthFxCallout({ breakdown }: NetWorthFxCalloutProps) {
  const { money } = useFormatters();
  const { t } = useTranslation("analytics");
  const { costBasis, fxDelta, spot } = breakdown;
  const deltaClass =
    fxDelta > 0 ? "text-amount-income" : fxDelta < 0 ? "text-amount-expense" : "text-muted-foreground";

  return (
    <div className="rounded-lg border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("netWorth.fx.label")}
          </div>
          <div className={`text-xl font-bold tabular-nums mt-0.5 ${deltaClass}`}>
            {fxDelta > 0 ? "+" : fxDelta < 0 ? "−" : ""}
            {money(Math.abs(fxDelta))}
          </div>
        </div>
        <div className="text-sm tabular-nums text-muted-foreground">
          {t("netWorth.fx.relation", {
            spot: money(spot),
            cost: money(costBasis),
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{t("netWorth.fx.explanation")}</p>
    </div>
  );
}
