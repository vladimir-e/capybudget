import type { ReactNode } from "react";
import { Check, FileText, Sparkles, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBudgetUI } from "@/contexts/budget-context";
import { useCapySessionContext } from "@/contexts/capy-session-context";

const MOD = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+";

interface StepProps {
  icon: ReactNode;
  label: string;
  sublabel: ReactNode;
  done?: boolean;
  action: ReactNode;
}

function Step({ icon, label, sublabel, done, action }: StepProps) {
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
          {done && <span className="text-xs font-normal text-muted-foreground">Done</span>}
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
  const { hasAccounts, openAccountDialog, startTransaction } = useBudgetUI();
  const { setOpen: setCapyOpen } = useCapySessionContext();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-base font-medium text-foreground/90">Let&rsquo;s set up your budget</p>
      <p className="mt-1 text-sm text-muted-foreground">Three steps to get going.</p>

      <ol aria-label="Setup steps" className="mt-6 divide-y divide-border/50 text-left">
        <Step
          icon={<Wallet />}
          label="Add your accounts"
          sublabel="Wallet, credit cards, bank accounts…"
          done={hasAccounts}
          action={
            <Button variant="outline" size="sm" onClick={openAccountDialog}>
              Add account
            </Button>
          }
        />

        <Step
          icon={<FileText />}
          label="Log transactions"
          sublabel={
            <>
              Press <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground/80">{MOD}N</kbd>, or import from statements &amp; screenshots.
            </>
          }
          action={
            hasAccounts ? (
              <Button variant="outline" size="sm" onClick={startTransaction}>
                Add transaction
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
                      Add transaction
                    </Button>
                  }
                />
                <TooltipContent>Add an account first.</TooltipContent>
              </Tooltip>
            )
          }
        />

        <Step
          icon={<Sparkles />}
          label="Ask Capy"
          sublabel="Your AI assistant — spending, budgets, anything."
          action={
            <Button variant="outline" size="sm" onClick={() => setCapyOpen(true)}>
              Ask Capy
            </Button>
          }
        />
      </ol>
    </div>
  );
}
