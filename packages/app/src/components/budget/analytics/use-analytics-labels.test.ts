import { afterAll, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { i18n } from "@capybudget/i18n"
import {
  useBasisLabel,
  useBasisOptionLabel,
  useCategorySeriesLabel,
  useMonthLabel,
} from "./use-analytics-labels"

async function withLocale<T>(locale: string, run: () => T): Promise<T> {
  await i18n.changeLanguage(locale)
  return run()
}

afterAll(async () => {
  await i18n.changeLanguage("en")
})

describe("useCategorySeriesLabel", () => {
  it("localizes the empty-id Uncategorized bucket", async () => {
    const { result } = renderHook(() => useCategorySeriesLabel())
    await withLocale("ru", () => expect(result.current("", "Uncategorized")).toBe("Без категории"))
    await withLocale("en", () => expect(result.current("", "Uncategorized")).toBe("Uncategorized"))
  })

  it("translates a canonical category and passes a custom one through", async () => {
    const { result } = renderHook(() => useCategorySeriesLabel())
    await withLocale("ru", () => {
      expect(result.current("cat-1", "Travel")).toBe("Путешествия")
      expect(result.current("cat-2", "Boat Fund")).toBe("Boat Fund")
    })
  })
})

describe("useMonthLabel", () => {
  it("renders the month name in the active locale from the ISO date", async () => {
    const iso = new Date(2026, 2, 1).toISOString()
    const { result } = renderHook(() => useMonthLabel())
    await withLocale("en", () => expect(result.current(iso)).toBe("Mar 2026"))
    await withLocale("ru", () => expect(result.current(iso)).toBe("март 2026"))
  })
})

describe("useBasisLabel", () => {
  it("localizes the fixed trailing labels", async () => {
    const { result } = renderHook(() => useBasisLabel())
    const viewed = new Date(2026, 0, 1)
    await withLocale("en", () => expect(result.current("trailing3", viewed)).toBe("3-mo avg"))
    await withLocale("ru", () => expect(result.current("trailing6", viewed)).toBe("сред. за 6 мес."))
  })

  it("resolves sameMonthLastYear to the month it points at", async () => {
    const { result } = renderHook(() => useBasisLabel())
    await withLocale("en", () =>
      expect(result.current("sameMonthLastYear", new Date(2026, 0, 1))).toBe("Jan 2025"),
    )
  })
})

describe("useBasisOptionLabel", () => {
  it("renders the long-form picker options", async () => {
    const { result } = renderHook(() => useBasisOptionLabel())
    await withLocale("en", () => expect(result.current("trailing3")).toBe("3 months"))
    await withLocale("ru", () => expect(result.current("sameMonthLastYear")).toBe("тот же месяц год назад"))
  })
})
