import { useTranslation } from "@capybudget/i18n"

/**
 * Semantic labels for the budget shell's route chrome — the recurring
 * structural copy that's easy to miss in a sweep (route headers, the
 * not-found state) and the one formatted count. Components read
 * `labels.allAccounts()` / `labels.transactionCount(n)` instead of the raw
 * catalog keys, so the shared route mirrors (`packages/app` and `apps/demo`)
 * stay phrased in one place. One-off leaf copy stays raw `t()`.
 */
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
