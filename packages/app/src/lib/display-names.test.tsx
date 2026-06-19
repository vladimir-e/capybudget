import { describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { DEFAULT_CATEGORIES, type AccountType } from "@capybudget/core"
import { i18n } from "@capybudget/i18n"
import {
  CANONICAL_GROUP_NAMES,
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

  // Pins the en values the dropped ACCOUNT_TYPE_LABELS constant used to carry:
  // satisfies Record only proves the key exists, not that the en value is right.
  it("resolves every account type to its English label", () => {
    const { result } = renderHook(() => useAccountTypeLabel(), { wrapper: localeWrapper("en") })
    const expected: Record<AccountType, string> = {
      cash: "Cash",
      checking: "Checking",
      savings: "Savings",
      credit_card: "Credit Card",
      loan: "Loans",
      asset: "Assets",
      crypto: "Crypto",
    }
    for (const [type, label] of Object.entries(expected)) {
      expect(result.current(type as AccountType)).toBe(label)
    }
  })
})

describe("en-value identity pins", () => {
  it("renders every canonical category's en value as its canonical name", () => {
    const { result } = renderHook(() => useCategoryDisplayName(), { wrapper: localeWrapper("en") })
    for (const { name } of DEFAULT_CATEGORIES) {
      expect(result.current(name)).toBe(name)
    }
  })

  it("renders every canonical group's en value as its canonical name", () => {
    const { result } = renderHook(() => useGroupDisplayName(), { wrapper: localeWrapper("en") })
    for (const name of CANONICAL_GROUP_NAMES) {
      expect(result.current(name)).toBe(name)
    }
  })
})
