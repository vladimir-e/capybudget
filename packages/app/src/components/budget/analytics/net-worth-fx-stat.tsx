import type { NetWorthBreakdown } from "@capybudget/core";
import { useTranslation } from "@capybudget/i18n";
import { useFormatters } from "@/hooks/use-formatters";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface NetWorthFxStatProps {
  breakdown: NetWorthBreakdown;
}

/** The unrealized currency gain/loss: the gap between a foreign account's cost
 *  basis (flows valued at the rates stamped when they happened) and its spot
 *  value (today's rate). Makes the headline relationship legible — current value
 *  = cost basis + this gain/loss — so the spot net worth and the cost-basis
 *  over-time chart don't silently disagree. Rendered as a 4th stat in the
 *  summary strip only when a foreign account exists; the delta itself may still
 *  be 0 if rates haven't moved. The cost → spot relation lives in the tooltip,
 *  since the strip stat has no room for it beside the value. */
export function NetWorthFxStat({ breakdown }: NetWorthFxStatProps) {
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
            <p>{t("netWorth.fx.explanation")}</p>
            <p className="mt-1.5 tabular-nums text-muted-foreground">
              {t("netWorth.fx.relation", { spot: money(spot), cost: money(costBasis) })}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${deltaClass}`}>
        {sign}
        {money(Math.abs(fxDelta))}
      </div>
    </div>
  );
}
