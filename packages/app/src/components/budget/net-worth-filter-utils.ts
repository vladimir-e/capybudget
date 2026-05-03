import type { Account } from "@capybudget/core";

/** Compute the next set of net-worth-excluded ids when one account's checkbox
 *  is toggled. Pure helper extracted for testing — flips one id while
 *  preserving every other excluded id. */
export function computeToggleExclusions(
  accounts: Account[],
  toggledId: string,
  nextIncluded: boolean,
): Set<string> {
  const next = new Set(
    accounts.filter((a) => a.excludeFromNetWorth).map((a) => a.id),
  );
  if (nextIncluded) next.delete(toggledId);
  else next.add(toggledId);
  return next;
}
