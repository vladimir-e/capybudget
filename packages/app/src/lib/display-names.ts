import {
  CATEGORY_GROUP_ORDER,
  DEFAULT_CATEGORIES,
  type AccountType,
} from "@capybudget/core"
import { useTranslation } from "@capybudget/i18n"

/**
 * Canonical-display translation.
 *
 * Category and group names are user data — stored verbatim in `categories.csv`
 * and freely renamable. Defaults seed in English (the canonical form) and stay
 * stored in English so AI/import/analytics keep matching on stable strings. The
 * localization is display-time, by canonical match: a stored name that exactly
 * equals a canonical default renders its translation; anything else (renamed or
 * user-created) renders verbatim, never translated.
 *
 * The literal name tuples below ARE the `budget:canonicalCategory.*` /
 * `canonicalGroup.*` catalog keys, so they double as the typed key space.
 * `display-names.test.ts` asserts they stay in lockstep with core's seed.
 */

export const CANONICAL_CATEGORY_NAMES = [
  "Paycheck",
  "Other Income",
  "Housing",
  "Bills & Utilities",
  "Subscriptions",
  "Groceries",
  "Dining Out",
  "Transportation",
  "Alcohol & Smoking",
  "Health & Beauty",
  "Clothing",
  "Fun & Hobbies",
  "Allowances",
  "Education & Business",
  "Gifts & Giving",
  "Housekeeping & Maintenance",
  "Big Purchases",
  "Travel",
  "Taxes & Fees",
] as const

/** The "Archived" section is a UI sentinel group, not a `CategoryGroup`, but it
 *  renders alongside the seeded groups and is canonical for the same reasons. */
export const CANONICAL_GROUP_NAMES = [...CATEGORY_GROUP_ORDER, "Archived"] as const

type CanonicalCategoryName = (typeof CANONICAL_CATEGORY_NAMES)[number]
type CanonicalGroupName = (typeof CANONICAL_GROUP_NAMES)[number]

const CANONICAL_CATEGORY_SET = new Set<string>(CANONICAL_CATEGORY_NAMES)
const CANONICAL_GROUP_SET = new Set<string>(CANONICAL_GROUP_NAMES)

function isCanonicalCategory(name: string): name is CanonicalCategoryName {
  return CANONICAL_CATEGORY_SET.has(name)
}

function isCanonicalGroup(name: string): name is CanonicalGroupName {
  return CANONICAL_GROUP_SET.has(name)
}

/** Names of categories the app seeds — `display-names.test.ts` pins this to
 *  core so the tuple above can't silently drift from what gets stored. */
export const SEEDED_CATEGORY_NAMES = DEFAULT_CATEGORIES.map((c) => c.name)

/** `(stored) => isCanonical(stored) ? translation : stored`. */
export function useCategoryDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalCategory(name) ? t(`canonicalCategory.${name}`) : name
}

/** Same canonical-match contract as `useCategoryDisplayName`, for group names. */
export function useGroupDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalGroup(name) ? t(`canonicalGroup.${name}`) : name
}

/** Localized label for an account type. Core's enum/order stays the source of
 *  truth; only the display string is localized. */
export function useAccountTypeLabel(): (type: AccountType) => string {
  const { t } = useTranslation("budget")
  return (type: AccountType) => t(`accountType.${type}`)
}
