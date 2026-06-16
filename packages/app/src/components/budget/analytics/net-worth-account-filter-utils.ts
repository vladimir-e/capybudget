import type { Account } from "@capybudget/core";

/** The transient Net Worth filter tracks an EXCLUDED-id set; default empty means
 *  every account is included, so accounts added later are included automatically. */

/** Account ids the chart should count: all accounts minus the excluded set. */
export function computeIncludedIds(
  accounts: Account[],
  excludedIds: Set<string>,
): Set<string> {
  return new Set(accounts.filter((a) => !excludedIds.has(a.id)).map((a) => a.id));
}

/** Next excluded set after flipping one account's checkbox. Included → drop the
 *  id; excluded → add it. Returns a new set; never mutates the input. */
export function toggleAccountInclusion(
  toggledId: string,
  nextIncluded: boolean,
  excludedIds: Set<string>,
): Set<string> {
  const next = new Set(excludedIds);
  if (nextIncluded) next.delete(toggledId);
  else next.add(toggledId);
  return next;
}

/** Next excluded set after setting a batch of ids to a target included-state —
 *  drives per-group toggles and the global select-all / clear-all controls. */
export function setInclusionForIds(
  ids: string[],
  nextIncluded: boolean,
  excludedIds: Set<string>,
): Set<string> {
  const next = new Set(excludedIds);
  for (const id of ids) {
    if (nextIncluded) next.delete(id);
    else next.add(id);
  }
  return next;
}
