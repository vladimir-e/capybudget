import { type BudgetBasis, formatMonthShort } from "@capybudget/core"
import { useLocale, useTranslation } from "@capybudget/i18n"
import { useCategoryDisplayName } from "@/lib/display-names"

/**
 * Display-time localization for the strings core analytics bakes in English so
 * its series-matching joins stay stable: the "Unknown"/"Uncategorized"
 * fallbacks, the month labels on chart axes, and the basis labels. Core keeps
 * emitting canonical English; these hooks translate only at the render edge.
 */

/** Localized name for an analytics category series/slice: the empty-id
 *  Uncategorized bucket renders the localized fallback, a canonical default
 *  renders its translation, and a renamed/custom category renders verbatim. */
export function useCategorySeriesLabel(): (categoryId: string, categoryName: string) => string {
  const { t } = useTranslation("analytics")
  const categoryDisplay = useCategoryDisplayName()
  return (categoryId: string, categoryName: string) =>
    categoryId === "" ? t("fallback.uncategorized") : categoryDisplay(categoryName)
}

/** Localized chart label for a month, derived from the point's ISO `date` so
 *  the wording follows the active locale instead of core's English `month`. */
export function useMonthLabel(): (isoDate: string) => string {
  const { t } = useTranslation("analytics")
  const locale = useLocale()
  return (isoDate: string) => {
    const d = new Date(isoDate)
    return t("monthLabel", { month: formatMonthShort(d, locale), year: d.getFullYear() })
  }
}

/** Localized chart label for a weekly bucket ("Mar 10"), from the bucket's ISO
 *  start date. */
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
} as const satisfies Record<BudgetBasis, string>

/** Long-form basis option for the picker menu ("3 months"). */
export function useBasisOptionLabel(): (basis: BudgetBasis) => string {
  const { t } = useTranslation("analytics")
  return (basis: BudgetBasis) => t(BASIS_OPTION_KEY[basis])
}

/** Resolved reference label for a basis ("3-mo avg" / "Mar 2025"), localized:
 *  the trailing bases are fixed strings, `sameMonthLastYear` resolves to the
 *  month it points at. */
export function useBasisLabel(): (basis: BudgetBasis, viewedMonth: Date) => string {
  const { t } = useTranslation("analytics")
  const locale = useLocale()
  return (basis: BudgetBasis, viewedMonth: Date) => {
    if (basis === "sameMonthLastYear") {
      const d = new Date(viewedMonth.getFullYear() - 1, viewedMonth.getMonth(), 1)
      return t("basis.monthLabel", { month: formatMonthShort(d, locale), year: d.getFullYear() })
    }
    return t(`basis.${basis}`)
  }
}
