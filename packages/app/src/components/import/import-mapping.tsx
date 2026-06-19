import type { Account } from "@capybudget/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountMappingSelector } from "./account-mapping-selector";
import { Building2 } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────

/** Maps a source string → existing entity ID, or "__create__" for new */
export type EntityMapping = Record<string, string>;

interface ImportMappingRowsProps {
  sourceAccounts: string[];
  accounts: Account[];
  accountMapping: EntityMapping;
  onAccountMappingChange: (mapping: EntityMapping) => void;
  /** Scroll once more than this many rows exist, so a long list can't push a
   *  surrounding dialog's footer off-screen. Pass `Infinity` to defer scrolling
   *  to an outer container (the merge confirmation owns its own scroll region). */
  scrollAfter?: number;
}

// ── Component ───────────────────────────────────────────────────

/** One row per imported account: the imported name → a target-account selector
 *  (an existing account, or create-on-merge — the default). Edits apply live.
 *  Rendered both in the Map-accounts dialog and the merge confirmation. */
export function ImportMappingRows({
  sourceAccounts,
  accounts,
  accountMapping,
  onAccountMappingChange,
  scrollAfter = 5,
}: ImportMappingRowsProps) {
  const rows = (
    <div className="space-y-2.5">
      {sourceAccounts.map((source) => (
        <div key={source} className="flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <span className="truncate text-sm text-foreground/80">{source}</span>
          </div>
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
      ))}
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
