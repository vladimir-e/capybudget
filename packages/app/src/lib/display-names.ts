import {
  CATEGORY_GROUP_ORDER,
  DEFAULT_CATEGORIES,
  type AccountType,
} from "@capybudget/core"
import { useTranslation } from "@capybudget/i18n"
import type { BudgetKey } from "@/lib/i18n-keys"

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
 * The literal name tuples below double as the `canonicalCategory.*` /
 * `canonicalGroup.*` catalog-key space. The `*_KEY` maps pair each enum member
 * with its `budget`-namespace key; typing them `satisfies Record<Enum,
 * BudgetKey>` makes the compiler enforce both exhaustiveness (every member
 * mapped) and key validity (every value is a real catalog key).
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

const CANONICAL_CATEGORY_KEY = {
  Paycheck: "canonicalCategory.Paycheck",
  "Other Income": "canonicalCategory.Other Income",
  Housing: "canonicalCategory.Housing",
  "Bills & Utilities": "canonicalCategory.Bills & Utilities",
  Subscriptions: "canonicalCategory.Subscriptions",
  Groceries: "canonicalCategory.Groceries",
  "Dining Out": "canonicalCategory.Dining Out",
  Transportation: "canonicalCategory.Transportation",
  "Alcohol & Smoking": "canonicalCategory.Alcohol & Smoking",
  "Health & Beauty": "canonicalCategory.Health & Beauty",
  Clothing: "canonicalCategory.Clothing",
  "Fun & Hobbies": "canonicalCategory.Fun & Hobbies",
  Allowances: "canonicalCategory.Allowances",
  "Education & Business": "canonicalCategory.Education & Business",
  "Gifts & Giving": "canonicalCategory.Gifts & Giving",
  "Housekeeping & Maintenance": "canonicalCategory.Housekeeping & Maintenance",
  "Big Purchases": "canonicalCategory.Big Purchases",
  Travel: "canonicalCategory.Travel",
  "Taxes & Fees": "canonicalCategory.Taxes & Fees",
} satisfies Record<CanonicalCategoryName, BudgetKey>

const CANONICAL_GROUP_KEY = {
  Income: "canonicalGroup.Income",
  Fixed: "canonicalGroup.Fixed",
  "Daily Living": "canonicalGroup.Daily Living",
  Personal: "canonicalGroup.Personal",
  Irregular: "canonicalGroup.Irregular",
  Archived: "canonicalGroup.Archived",
} satisfies Record<CanonicalGroupName, BudgetKey>

const ACCOUNT_TYPE_KEY = {
  cash: "accountType.cash",
  checking: "accountType.checking",
  savings: "accountType.savings",
  credit_card: "accountType.credit_card",
  loan: "accountType.loan",
  asset: "accountType.asset",
  crypto: "accountType.crypto",
} satisfies Record<AccountType, BudgetKey>

function isCanonicalCategory(name: string): name is CanonicalCategoryName {
  return name in CANONICAL_CATEGORY_KEY
}

function isCanonicalGroup(name: string): name is CanonicalGroupName {
  return name in CANONICAL_GROUP_KEY
}

/** Names of categories the app seeds — `display-names.test.ts` pins this to
 *  core so the tuple above can't silently drift from what gets stored. */
export const SEEDED_CATEGORY_NAMES = DEFAULT_CATEGORIES.map((c) => c.name)

/** `(stored) => isCanonical(stored) ? translation : stored`. */
export function useCategoryDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalCategory(name) ? t(CANONICAL_CATEGORY_KEY[name]) : name
}

/** Same canonical-match contract as `useCategoryDisplayName`, for group names. */
export function useGroupDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalGroup(name) ? t(CANONICAL_GROUP_KEY[name]) : name
}

/** Localized label for an account type. Core's enum/order stays the source of
 *  truth; only the display string is localized. */
export function useAccountTypeLabel(): (type: AccountType) => string {
  const { t } = useTranslation("budget")
  return (type: AccountType) => t(ACCOUNT_TYPE_KEY[type])
}
