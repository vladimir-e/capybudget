import {
  CATEGORY_GROUP_ORDER,
  DEFAULT_CATEGORIES,
  type AccountType,
} from "@capybudget/core"
import { useTranslation } from "@capybudget/i18n"
import type { BudgetKey } from "@/lib/i18n-keys"

// Category and group names are user data, stored and matched in English so
// AI/import/analytics joins stay stable. Localization is display-time by
// canonical match: a stored name that exactly equals a canonical default
// renders its translation; anything renamed or user-created renders verbatim.

export const CANONICAL_GROUP_NAMES = [...CATEGORY_GROUP_ORDER, "Archived"] as const

type CanonicalCategoryName = (typeof DEFAULT_CATEGORIES)[number]["name"]
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

export function useCategoryDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalCategory(name) ? t(CANONICAL_CATEGORY_KEY[name]) : name
}

export function useGroupDisplayName(): (name: string) => string {
  const { t } = useTranslation("budget")
  return (name: string) =>
    isCanonicalGroup(name) ? t(CANONICAL_GROUP_KEY[name]) : name
}

export function useAccountTypeLabel(): (type: AccountType) => string {
  const { t } = useTranslation("budget")
  return (type: AccountType) => t(ACCOUNT_TYPE_KEY[type])
}
