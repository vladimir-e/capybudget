import type { ReactNode } from "react";
import { Check, FileText, Sparkles, Wallet } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { useTranslation } from "@capybudget/i18n";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBudgetUI } from "@/contexts/budget-context";
import { useCapySessionContext } from "@/contexts/capy-session-context";
import { modKey } from "@/lib/platform";

interface StepProps {
  icon: ReactNode;
  label: string;
  sublabel: ReactNode;
  done?: boolean;
  action: ReactNode;
}

function Step({ icon, label, sublabel, done, action }: StepProps) {
  const { t } = useTranslation("onboarding");
  return (
    <li className="flex items-center gap-4 py-3">
      <span
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors ${
          done
            ? "border-transparent bg-muted text-muted-foreground"
            : "border-border/60 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4"
        }`}
        aria-hidden
      >
        {done ? <Check className="h-4 w-4" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
          {label}
          {done && <span className="text-xs font-normal text-muted-foreground">{t("firstRun.done")}</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </li>
  );
}

/** First-run onboarding panel: a calm, state-aware checklist shown only when the
 *  whole budget is empty and the user is on the all-accounts view. It reflects
 *  live state — step 1 marks done and step 2 activates once an account exists —
 *  and disappears entirely the moment any transaction lands. */
export function FirstRunGuide() {
  const { t } = useTranslation("onboarding");
  const { hasAccounts, openAccountDialog, startTransaction } = useBudgetUI();
  const { setOpen: setCapyOpen } = useCapySessionContext();
  const navigate = useNavigate();
  const { path, name } = useSearch({ from: "/budget" });

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-base font-medium text-foreground/90">{t("firstRun.title")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("firstRun.subtitle")}</p>

      <ol aria-label={t("firstRun.stepsLabel")} className="mt-6 divide-y divide-border/50 text-left">
        <Step
          icon={<Wallet />}
          label={t("firstRun.addAccounts.label")}
          sublabel={t("firstRun.addAccounts.sublabel")}
          done={hasAccounts}
          action={
            <Button variant="outline" size="sm" onClick={openAccountDialog}>
              {t("firstRun.addAccounts.action")}
            </Button>
          }
        />

        <Step
          icon={<FileText />}
          label={t("firstRun.logTransactions.label")}
          sublabel={
            <>
              {t("firstRun.logTransactions.sublabelBefore")}
              <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground/80">{modKey}N</kbd>
              {t("firstRun.logTransactions.sublabelAfter")}
            </>
          }
          action={
            hasAccounts ? (
              <Button variant="outline" size="sm" onClick={startTransaction}>
                {t("firstRun.logTransactions.action")}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-disabled
                      onClick={(e) => e.preventDefault()}
                      className="cursor-not-allowed opacity-50"
                    >
                      {t("firstRun.logTransactions.action")}
                    </Button>
                  }
                />
                <TooltipContent>{t("firstRun.logTransactions.needsAccount")}</TooltipContent>
              </Tooltip>
            )
          }
        />

        <Step
          icon={<Sparkles />}
          label={t("firstRun.askCapy.label")}
          sublabel={t("firstRun.askCapy.sublabel")}
          action={
            <Button variant="outline" size="sm" onClick={() => setCapyOpen(true)}>
              {t("firstRun.askCapy.action")}
            </Button>
          }
        />
      </ol>

      <p className="mt-6 text-xs text-muted-foreground">
        {t("firstRun.docsBefore")}
        <button
          type="button"
          onClick={() => navigate({ to: "/budget/help", search: { path, name } })}
          className="text-foreground/70 underline underline-offset-2 transition-colors hover:text-foreground"
        >
          {t("firstRun.docsLink")}
        </button>
        {t("firstRun.docsAfter")}
      </p>
    </div>
  );
}
