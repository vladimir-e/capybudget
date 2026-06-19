import { describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { i18n } from "@capybudget/i18n"
import {
  useBasisLabel,
  useBasisOptionLabel,
  useCategorySeriesLabel,
  useMonthLabel,
} from "./use-analytics-labels"

/** Isolated translator: a clone fixed to one language, so a test never mutates
 *  the shared instance and there's nothing to reset between cases. */
function localeWrapper(locale: string) {
  const scoped = i18n.cloneInstance({ lng: locale })
  return ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={scoped}>{children}</I18nextProvider>
  )
}

describe("useCategorySeriesLabel", () => {
  it("localizes the empty-id Uncategorized bucket", () => {
    const ru = renderHook(() => useCategorySeriesLabel(), { wrapper: localeWrapper("ru") })
    expect(ru.result.current("", "Uncategorized")).toBe("Без категории")
    const en = renderHook(() => useCategorySeriesLabel(), { wrapper: localeWrapper("en") })
    expect(en.result.current("", "Uncategorized")).toBe("Uncategorized")
  })

  it("translates a canonical category and passes a custom one through", () => {
    const { result } = renderHook(() => useCategorySeriesLabel(), { wrapper: localeWrapper("ru") })
    expect(result.current("cat-1", "Travel")).toBe("Путешествия")
    expect(result.current("cat-2", "Boat Fund")).toBe("Boat Fund")
  })
})

describe("useMonthLabel", () => {
  it("renders the month name in the active locale from the ISO date", () => {
    const iso = new Date(2026, 2, 1).toISOString()
    const en = renderHook(() => useMonthLabel(), { wrapper: localeWrapper("en") })
    expect(en.result.current(iso)).toBe("Mar 2026")
    const ru = renderHook(() => useMonthLabel(), { wrapper: localeWrapper("ru") })
    expect(ru.result.current(iso)).toBe("март 2026")
  })
})

describe("useBasisLabel", () => {
  it("localizes the fixed trailing labels", () => {
    const viewed = new Date(2026, 0, 1)
    const en = renderHook(() => useBasisLabel(), { wrapper: localeWrapper("en") })
    expect(en.result.current("trailing3", viewed)).toBe("3-mo avg")
    const ru = renderHook(() => useBasisLabel(), { wrapper: localeWrapper("ru") })
    expect(ru.result.current("trailing6", viewed)).toBe("сред. за 6 мес.")
  })

  it("resolves sameMonthLastYear to the month it points at", () => {
    const { result } = renderHook(() => useBasisLabel(), { wrapper: localeWrapper("en") })
    expect(result.current("sameMonthLastYear", new Date(2026, 0, 1))).toBe("Jan 2025")
  })
})

describe("useBasisOptionLabel", () => {
  it("renders the long-form picker options", () => {
    const en = renderHook(() => useBasisOptionLabel(), { wrapper: localeWrapper("en") })
    expect(en.result.current("trailing3")).toBe("3 months")
    const ru = renderHook(() => useBasisOptionLabel(), { wrapper: localeWrapper("ru") })
    expect(ru.result.current("sameMonthLastYear")).toBe("тот же месяц год назад")
  })
})
