import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Account } from "@capybudget/core";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  groupAccounts,
  setInclusionForIds,
  toggleAccountInclusion,
  type AccountGroup,
} from "./net-worth-account-filter-utils";

interface NetWorthAccountFilterProps {
  accounts: Account[];
  excludedIds: Set<string>;
  onChange: (next: Set<string>) => void;
}

/** Controlled popover + checklist over the TRANSIENT excluded-id set. Dumb:
 *  derives everything from props and reports the next excluded set via onChange. */
export function NetWorthAccountFilter({
  accounts,
  excludedIds,
  onChange,
}: NetWorthAccountFilterProps) {
  const [query, setQuery] = useState("");

  const totalCount = accounts.length;
  const includedCount = accounts.reduce(
    (n, a) => (excludedIds.has(a.id) ? n : n + 1),
    0,
  );
  const triggerLabel =
    excludedIds.size === 0
      ? "All accounts"
      : `${includedCount} of ${totalCount} accounts`;

  const groups = useMemo(() => groupAccounts(accounts), [accounts]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        accounts: g.accounts.filter((a) => a.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.accounts.length > 0);
  }, [groups, query]);

  const visibleIds = useMemo(
    () => visibleGroups.flatMap((g) => g.accounts.map((a) => a.id)),
    [visibleGroups],
  );
  const visibleIncludedCount = visibleIds.reduce(
    (n, id) => (excludedIds.has(id) ? n : n + 1),
    0,
  );

  function setGroupInclusion(group: AccountGroup, nextIncluded: boolean) {
    onChange(
      setInclusionForIds(
        group.accounts.map((a) => a.id),
        nextIncluded,
        excludedIds,
      ),
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={`Accounts in Net Worth — ${triggerLabel}`}
          />
        }
      >
        {triggerLabel}
        <ChevronDown className="ml-1 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[60vh] w-72 flex-col gap-0 p-0"
      >
        <div className="shrink-0 border-b border-border/50 p-2.5">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts"
            aria-label="Search accounts"
          />
          <div className="mt-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange(setInclusionForIds(visibleIds, true, excludedIds))}
              disabled={visibleIncludedCount === visibleIds.length}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange(setInclusionForIds(visibleIds, false, excludedIds))}
              disabled={visibleIncludedCount === 0}
            >
              Clear all
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {visibleGroups.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No accounts match.
            </div>
          )}
          {visibleGroups.map((group) => {
            const groupIncluded = group.accounts.filter(
              (a) => !excludedIds.has(a.id),
            ).length;
            const allIncluded = groupIncluded === group.accounts.length;
            const noneIncluded = groupIncluded === 0;

            return (
              <div key={group.key} className="mb-1">
                <label className="flex cursor-pointer items-center gap-2 px-3 pt-1 pb-0.5 hover:bg-accent/50">
                  <Checkbox
                    checked={allIncluded}
                    indeterminate={!allIncluded && !noneIncluded}
                    onCheckedChange={(checked) =>
                      setGroupInclusion(group, checked === true)
                    }
                    aria-label={`Toggle all ${group.label} accounts`}
                  />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                    {group.label}
                  </span>
                </label>
                {group.accounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1 pl-7 hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={!excludedIds.has(a.id)}
                      onCheckedChange={(checked) =>
                        onChange(
                          toggleAccountInclusion(a.id, checked === true, excludedIds),
                        )
                      }
                    />
                    <span className="truncate text-sm">{a.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
