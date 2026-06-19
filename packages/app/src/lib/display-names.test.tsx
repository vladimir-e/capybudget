import { describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { i18n } from "@capybudget/i18n"
import {
  useAccountTypeLabel,
  useCategoryDisplayName,
  useGroupDisplayName,
} from "./display-names"

function localeWrapper(locale: string) {
  const scoped = i18n.cloneInstance({ lng: locale })
  return ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={scoped}>{children}</I18nextProvider>
  )
}

describe("useCategoryDisplayName", () => {
  it("translates a canonical default name", () => {
    const { result } = renderHook(() => useCategoryDisplayName(), { wrapper: localeWrapper("ru") })
    expect(result.current("Groceries")).toBe("Продукты")
  })

  it("passes a renamed / custom name through verbatim", () => {
    const { result } = renderHook(() => useCategoryDisplayName(), { wrapper: localeWrapper("ru") })
    expect(result.current("Продукты у бабушки")).toBe("Продукты у бабушки")
    expect(result.current("Groceries (old)")).toBe("Groceries (old)")
  })
})

describe("useGroupDisplayName", () => {
  it("translates canonical groups and the Archived sentinel", () => {
    const { result } = renderHook(() => useGroupDisplayName(), { wrapper: localeWrapper("ru") })
    expect(result.current("Daily Living")).toBe("Повседневные")
    expect(result.current("Archived")).toBe("Архив")
  })

  it("passes a custom group through verbatim", () => {
    const { result } = renderHook(() => useGroupDisplayName(), { wrapper: localeWrapper("ru") })
    expect(result.current("Side Hustle")).toBe("Side Hustle")
  })
})

describe("useAccountTypeLabel", () => {
  it("localizes each account type", () => {
    const ru = renderHook(() => useAccountTypeLabel(), { wrapper: localeWrapper("ru") })
    expect(ru.result.current("credit_card")).toBe("Кредитная карта")
    expect(ru.result.current("cash")).toBe("Наличные")
    const en = renderHook(() => useAccountTypeLabel(), { wrapper: localeWrapper("en") })
    expect(en.result.current("credit_card")).toBe("Credit Card")
  })
})
