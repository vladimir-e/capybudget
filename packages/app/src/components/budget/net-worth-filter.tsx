import { Settings2 } from "lucide-react";
import type { Account } from "@capybudget/core";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@capybudget/core";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useSetNetWorthExclusions } from "@/hooks/use-account-mutations";

interface NetWorthFilterProps {
  accounts: Account[];
}

/** Cog popover for choosing which accounts to exclude from Net Worth.
 *  Checked = included (default), unchecked = excluded. Archived accounts are
 *  hidden — they're already excluded from Net Worth by virtue of being archived. */
export function NetWorthFilter({ accounts }: NetWorthFilterProps) {
  const setExclusions = useSetNetWorthExclusions();

  const candidates = accounts
    .filter((a) => !a.archived)
    .sort((a, b) => {
      const ai = ACCOUNT_TYPE_ORDER.indexOf(a.type);
      const bi = ACCOUNT_TYPE_ORDER.indexOf(b.type);
      if (ai !== bi) return ai - bi;
      return a.sortOrder - b.sortOrder;
    });

  function toggle(account: Account, included: boolean) {
    const next = new Set(
      accounts.filter((a) => a.excludeFromNetWorth).map((a) => a.id),
    );
    if (included) next.delete(account.id);
    else next.add(account.id);
    setExclusions.mutate(next);
  }

  // Group by type for display.
  const byType = new Map<string, Account[]>();
  for (const a of candidates) {
    const list = byType.get(a.type) ?? [];
    list.push(a);
    byType.set(a.type, list);
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Choose accounts in Net Worth"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand/50 hover:text-brand transition-colors"
          />
        }
      >
        <Settings2 className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex max-h-[60vh] w-64 flex-col gap-0 p-0"
      >
        <div className="shrink-0 border-b border-border/50 px-3 py-2">
          <div className="text-sm font-medium">Net Worth includes</div>
          <div className="text-xs text-muted-foreground">
            Uncheck to exclude from totals
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {candidates.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No active accounts.
            </div>
          )}
          {[...byType.entries()].map(([type, accts], idx) => (
            <div key={type} className={idx === 0 ? "" : "mt-1"}>
              <div className="px-3 pt-1 pb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                {ACCOUNT_TYPE_LABELS[type as Account["type"]]}
              </div>
              {accts.map((a) => {
                const included = !a.excludeFromNetWorth;
                return (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={included}
                      onCheckedChange={(checked) =>
                        toggle(a, checked === true)
                      }
                    />
                    <span className="truncate text-sm">{a.name}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
