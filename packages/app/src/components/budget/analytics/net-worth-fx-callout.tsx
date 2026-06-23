import type { NetWorthBreakdown } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatters } from "@/hooks/use-formatters";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface NetWorthFxCalloutProps {
  breakdown: NetWorthBreakdown;
}

/** The unrealized currency gain/loss: the gap between a foreign account's cost
 *  basis (flows valued at the rates stamped when they happened) and its spot
 *  value (today's rate). Makes the headline relationship legible — current value
 *  = cost basis + this gain/loss — so the spot net worth and the cost-basis
 *  over-time chart don't silently disagree. Rendered only when a foreign account
 *  exists; the delta itself may still be 0 if rates haven't moved. */
export function NetWorthFxCallout({ breakdown }: NetWorthFxCalloutProps) {
  const { money } = useFormatters();
  const { t } = useTranslation("analytics");
  const { costBasis, fxDelta, spot } = breakdown;

  const tone = fxDelta > 0 ? "gain" : fxDelta < 0 ? "loss" : "flat";
  const deltaClass =
    tone === "gain"
      ? "text-amount-income"
      : tone === "loss"
        ? "text-amount-expense"
        : "text-muted-foreground";
  const sign = fxDelta > 0 ? "+" : fxDelta < 0 ? "−" : "";

  return (
    <div className="rounded-lg border bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t(`netWorth.fx.label.${tone}`)}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex cursor-help"
                    aria-label={t("netWorth.fx.whatIsThis")}
                  />
                }
              >
                <Info className="h-3.5 w-3.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs font-normal normal-case tracking-normal">
                {t("netWorth.fx.explanation")}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className={`text-xl font-bold tabular-nums mt-0.5 ${deltaClass}`}>
            {sign}
            {money(Math.abs(fxDelta))}
          </div>
        </div>
        <div className="text-sm tabular-nums text-muted-foreground">
          {t("netWorth.fx.relation", { spot: money(spot), cost: money(costBasis) })}
        </div>
      </div>
    </div>
  );
}
