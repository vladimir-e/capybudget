import { type BudgetBasis, formatMonthShort } from "@capybudget/core"
import { useLocale, useTranslation } from "@capybudget/i18n"
import { useCategoryDisplayName } from "@/lib/display-names"
import type { AnalyticsKey } from "@/lib/i18n-keys"

// Core analytics bakes labels in English so its series-matching joins stay
// stable; these hooks translate only at the render edge.

export function useCategorySeriesLabel(): (categoryId: string, categoryName: string) => string {
  const { t } = useTranslation("analytics")
  const categoryDisplay = useCategoryDisplayName()
  return (categoryId: string, categoryName: string) =>
    categoryId === "" ? t("fallback.uncategorized") : categoryDisplay(categoryName)
}

export function useMonthLabel(): (isoDate: string) => string {
  const { t } = useTranslation("analytics")
  const locale = useLocale()
  return (isoDate: string) => {
    const d = new Date(isoDate)
    return t("monthLabel", { month: formatMonthShort(d, locale), year: d.getFullYear() })
  }
}

export function useWeekLabel(): (isoDate: string) => string {
  const { t } = useTranslation("analytics")
  const locale = useLocale()
  return (isoDate: string) => {
    const d = new Date(isoDate)
    return t("weekLabel", { month: formatMonthShort(d, locale), day: d.getDate() })
  }
}

const BASIS_OPTION_KEY = {
  trailing3: "basis.trailing3Option",
  trailing6: "basis.trailing6Option",
  trailing12: "basis.trailing12Option",
  sameMonthLastYear: "basis.sameMonthLastYearOption",
} satisfies Record<BudgetBasis, AnalyticsKey>

const BASIS_SHORT_KEY = {
  trailing3: "basis.trailing3",
  trailing6: "basis.trailing6",
  trailing12: "basis.trailing12",
} satisfies Record<Exclude<BudgetBasis, "sameMonthLastYear">, AnalyticsKey>

export function useBasisOptionLabel(): (basis: BudgetBasis) => string {
  const { t } = useTranslation("analytics")
  return (basis: BudgetBasis) => t(BASIS_OPTION_KEY[basis])
}

export function useBasisLabel(): (basis: BudgetBasis, viewedMonth: Date) => string {
  const { t } = useTranslation("analytics")
  const locale = useLocale()
  return (basis: BudgetBasis, viewedMonth: Date) => {
    if (basis === "sameMonthLastYear") {
      const d = new Date(viewedMonth.getFullYear() - 1, viewedMonth.getMonth(), 1)
      return t("basis.monthLabel", { month: formatMonthShort(d, locale), year: d.getFullYear() })
    }
    return t(BASIS_SHORT_KEY[basis])
  }
}
