import { Clock, Sparkles, X } from "lucide-react";

/** First-open framing for the magic-budgets model, so the tab reads as
 *  "Capy already budgets for you" rather than "a wall of bars to configure".
 *  Copy adapts to how much history backs the implicit targets:
 *   - none yet      → targets are coming, nothing to do.
 *   - a month or two → Capy is still learning; targets will sharpen.
 *   - enough        → the steady-state framing.
 *  Dismissable; the parent persists the dismissal. */
export function BudgetExplainer({
  monthsOfData,
  onDismiss,
}: {
  monthsOfData: number;
  onDismiss: () => void;
}) {
  let body: string;
  if (monthsOfData === 0) {
    body =
      "Capy sets soft targets from your spending — nothing to assign. There's no history yet, so it's tracking this month's spend; targets appear once a month or two is on the books. Set your own budget on any category to track that instead.";
  } else if (monthsOfData <= 2) {
    body =
      "Capy sets soft targets from your spending — nothing to assign. It's still learning your patterns, so targets will sharpen as more months come in. Set your own budget on any category to track that instead.";
  } else {
    body =
      "Capy sets soft targets from your spending — nothing to assign. The bar tracks this month against what you usually spend; set your own budget on any category to track that instead.";
  }

  return (
    <div className="relative flex items-start gap-3 rounded-lg bg-brand-subtle px-4 py-3 pr-10">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-foreground">Capy budgets itself</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Inline note for the history-less first month: every category is untargeted
 *  because there's nothing to infer from yet. Frames the empty bars as
 *  "forming" rather than broken, and points at this month's spend. Not
 *  dismissable — it's a state, and it disappears on its own once history
 *  exists. */
export function BudgetNoHistoryNote() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">No targets yet.</span> Capy
        sets them from your spending history, and this is your first month — so
        it's just tracking what you spend for now. Targets appear automatically
        as the months add up. Want one sooner? Set a budget on any category.
      </p>
    </div>
  );
}
