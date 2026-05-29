import { Clock } from "lucide-react";

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
