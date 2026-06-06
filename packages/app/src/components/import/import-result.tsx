import { CheckCircle2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunOutcome } from "@/stores/import-store";
import { readySummary } from "./import-table-utils";

/** The merge-ready completion banner — sits above the preview table. */
export function ReadyBanner({ counts }: { counts: { ready: number; duplicates: number } }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-brand/25 bg-brand/5 px-3.5 py-2.5 text-sm text-foreground/80">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" />
      <span>
        <span className="font-medium text-foreground">All set.</span>{" "}
        {readySummary(counts)}
      </span>
    </div>
  );
}

/**
 * The all-duplicate halt result — a prominent terminal moment that replaces the
 * table entirely. There's nothing to merge; the only action is to finish.
 */
export function NothingToImportResult({
  outcome,
  onDone,
}: {
  outcome: RunOutcome;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Inbox className="h-7 w-7" />
      </div>
      <p className="mt-4 text-lg font-semibold text-foreground">
        Nothing to import
      </p>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
        {outcome.message ??
          "Every transaction is already in your budget."}
      </p>
      <Button className="mt-6" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
