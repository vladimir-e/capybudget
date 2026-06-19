import { useTranslation } from "@capybudget/i18n"

// Shared by the packages/app and apps/demo route mirrors, so the budget shell's
// route chrome stays phrased in one place.
export interface BudgetLabels {
  allAccounts: () => string
  transactionCount: (count: number) => string
  accountNotFound: () => string
}

export function useBudgetLabels(): BudgetLabels {
  const { t } = useTranslation("budget")
  return {
    allAccounts: () => t("allAccounts.title"),
    transactionCount: (count: number) => t("allAccounts.transactionCount", { count }),
    accountNotFound: () => t("account.notFound"),
  }
}
