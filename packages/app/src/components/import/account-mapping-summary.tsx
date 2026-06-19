import type { MergeAccountSummary } from "@capybudget/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFormatMoney } from "@/contexts/currency-context";
import { ArrowRight, Building2, Sparkles } from "lucide-react";

interface AccountMappingSummaryProps {
  rows: MergeAccountSummary[];
}

/** Read-only, per-account view of where a merge's transactions land and the
 *  balance each account ends at. Presentational only — the caller derives the
 *  rows from the merge plan. Beyond five accounts the list scrolls so the
 *  surrounding dialog's footer always stays in view. */
export function AccountMappingSummary({ rows }: AccountMappingSummaryProps) {
  const { format } = useFormatMoney();

  if (rows.length === 0) return null;

  const list = (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li
          key={row.accountId}
          className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
            <span className="truncate text-muted-foreground">
              {row.sourceAccounts.length > 0 ? row.sourceAccounts.join(", ") : "Transfer"}
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="truncate font-medium text-foreground">{row.accountName}</span>
            {row.isNew && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-brand">
                <Sparkles className="h-2.5 w-2.5" />
                new
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {row.count} txn{row.count !== 1 ? "s" : ""}
          </span>
          <span
            className={`w-24 shrink-0 text-right text-sm font-semibold tabular-nums ${
              row.resultingBalance < 0
                ? "text-amount-expense/80"
                : row.resultingBalance > 0
                  ? "text-amount-income/80"
                  : ""
            }`}
          >
            {format(row.resultingBalance)}
          </span>
        </li>
      ))}
    </ul>
  );

  // Cap at five rows so a sixth scrolls into view: 5 × 2.25rem row + 4 × 0.375rem
  // gap. Keeps the dialog's footer on-screen no matter how many accounts merge.
  if (rows.length > 5) {
    return (
      <ScrollArea className="max-h-[12.75rem] pr-3">
        {list}
      </ScrollArea>
    );
  }

  return list;
}
