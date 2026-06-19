import type { Account, AccountType } from "@capybudget/core";
import { ACCOUNT_TYPE_ORDER } from "@capybudget/core";

/** The transient Net Worth filter tracks an EXCLUDED-id set; default empty means
 *  every account is included, so accounts added later are included automatically. */

// Groups key off the type or this sentinel, never a display label, so this stays
// locale-agnostic — labels are localized at the render edge.
export const ARCHIVED_GROUP_KEY = "__archived__";

export interface AccountGroup {
  key: AccountType | typeof ARCHIVED_GROUP_KEY;
  accounts: Account[];
}

/** The archived group mixes account types, so it needs the type tiebreaker that
 *  the per-type active groups don't (those are already type-homogeneous). */
function byTypeThenSortOrder(a: Account, b: Account): number {
  const ai = ACCOUNT_TYPE_ORDER.indexOf(a.type);
  const bi = ACCOUNT_TYPE_ORDER.indexOf(b.type);
  if (ai !== bi) return ai - bi;
  return a.sortOrder - b.sortOrder;
}

/** Group by type in ACCOUNT_TYPE_ORDER, archived accounts collected into a single
 *  trailing "Archived" section (never duplicated into their type group). */
export function groupAccounts(accounts: Account[]): AccountGroup[] {
  const active = accounts.filter((a) => !a.archived);
  const archived = accounts.filter((a) => a.archived);

  const groups: AccountGroup[] = [];
  for (const type of ACCOUNT_TYPE_ORDER) {
    const inType = active
      .filter((a) => a.type === type)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (inType.length > 0) {
      groups.push({ key: type, accounts: inType });
    }
  }

  if (archived.length > 0) {
    groups.push({
      key: ARCHIVED_GROUP_KEY,
      accounts: [...archived].sort(byTypeThenSortOrder),
    });
  }

  return groups;
}

/** Account ids the chart should count: all accounts minus the excluded set. */
export function computeIncludedIds(
  accounts: Account[],
  excludedIds: Set<string>,
): Set<string> {
  return new Set(accounts.filter((a) => !excludedIds.has(a.id)).map((a) => a.id));
}

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
