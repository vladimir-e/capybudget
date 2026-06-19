import type { Account } from "@capybudget/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFormatMoney } from "@/contexts/currency-context";
import { AccountMappingSelector } from "./account-mapping-selector";
import { Building2, Sparkles } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

/** Maps a source string → existing entity ID, or "__create__" for new */
export type EntityMapping = Record<string, string>;

/** Per-source-account merge facts, shown beside each row in the confirmation:
 *  the destination's resulting balance, whether it'll be created, and how many
 *  of this source's rows land. Absent in the plain Map-accounts dialog. */
export interface MappingRowMeta {
  resultingBalance: number;
  isNew: boolean;
  count: number;
}

interface ImportMappingRowsProps {
  sourceAccounts: string[];
  accounts: Account[];
  accountMapping: EntityMapping;
  onAccountMappingChange: (mapping: EntityMapping) => void;
  /** When provided, each row shows its destination's resulting balance, a "new"
   *  badge, and a muted row count — turning the mapping rows into the merge
   *  confirmation's editable summary. */
  rowMeta?: Record<string, MappingRowMeta>;
  /** Scroll once more than this many rows exist, so a long list can't push a
   *  surrounding dialog's footer off-screen. */
  scrollAfter?: number;
}

// ── Component ───────────────────────────────────────────────────

/** One row per imported account: the imported name → a target-account selector
 *  (an existing account, or create-on-merge — the default). Edits apply live.
 *  Rendered both in the Map-accounts dialog and, with `rowMeta`, as the merge
 *  confirmation's editable per-account summary. */
export function ImportMappingRows({
  sourceAccounts,
  accounts,
  accountMapping,
  onAccountMappingChange,
  rowMeta,
  scrollAfter = 5,
}: ImportMappingRowsProps) {
  const { format } = useFormatMoney();

  const rows = (
    <div className="space-y-2.5">
      {sourceAccounts.map((source) => {
        const meta = rowMeta?.[source];
        return (
          <div key={source} className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              <span className="truncate text-sm text-foreground/80">{source}</span>
              {meta?.isNew && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-brand">
                  <Sparkles className="h-2.5 w-2.5" />
                  new
                </span>
              )}
            </div>
            {meta && (
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {meta.count} txn{meta.count !== 1 ? "s" : ""}
                </span>
                <span
                  className={`w-24 text-right text-sm font-semibold tabular-nums ${
                    meta.resultingBalance < 0
                      ? "text-amount-expense/80"
                      : meta.resultingBalance > 0
                        ? "text-amount-income/80"
                        : ""
                  }`}
                >
                  {format(meta.resultingBalance)}
                </span>
              </div>
            )}
            <div className="w-52 shrink-0 [&_button:first-of-type]:w-full [&_button:first-of-type]:min-w-0">
              <AccountMappingSelector
                accounts={accounts}
                value={accountMapping[source]}
                sourceLabel={source}
                onChange={(v) =>
                  onAccountMappingChange({ ...accountMapping, [source]: v })
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  // A row is the h-8 selector (2rem) plus the space-y-2.5 (0.625rem) gap. Cap the
  // viewport at `scrollAfter` rows so the next one scrolls; the dropdown's portal
  // keeps it from being clipped by the overflow.
  if (sourceAccounts.length > scrollAfter) {
    const maxHeight = `${scrollAfter * 2 + (scrollAfter - 1) * 0.625}rem`;
    return (
      <ScrollArea className="pr-3" style={{ maxHeight }}>
        {rows}
      </ScrollArea>
    );
  }

  return rows;
}
