import { afterAll, describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { ACCOUNT_TYPE_ORDER } from "@capybudget/core"
import { i18n } from "@capybudget/i18n"
import {
  CANONICAL_CATEGORY_NAMES,
  SEEDED_CATEGORY_NAMES,
  useAccountTypeLabel,
  useCategoryDisplayName,
  useGroupDisplayName,
} from "./display-names"

async function withLocale<T>(locale: string, run: () => T): Promise<T> {
  await i18n.changeLanguage(locale)
  return run()
}

afterAll(async () => {
  await i18n.changeLanguage("en")
})

describe("canonical name tuples", () => {
  it("stay in lockstep with the categories core seeds", () => {
    expect([...CANONICAL_CATEGORY_NAMES]).toEqual(SEEDED_CATEGORY_NAMES)
  })

  it("has an en `accountType.*` translation for every core account type", () => {
    // `useAccountTypeLabel` builds `accountType.${type}` dynamically, so a new
    // type added to core's enum isn't statically checked. This pins the catalog
    // to `ACCOUNT_TYPE_ORDER`: a missing key renders as the echoed key string
    // ("accountType.brokerage"), which this catches.
    for (const type of ACCOUNT_TYPE_ORDER) {
      const key = `accountType.${type}`
      const label = i18n.getResource("en", "budget", key) as string | undefined
      expect(label, `missing en budget:${key}`).toBeTruthy()
      expect(label).not.toBe(key)
      expect(label).not.toBe(type)
    }
  })
})

describe("useCategoryDisplayName", () => {
  it("translates a canonical default name", async () => {
    const { result } = renderHook(() => useCategoryDisplayName())
    await withLocale("ru", () => expect(result.current("Groceries")).toBe("Продукты"))
    await withLocale("en", () => expect(result.current("Groceries")).toBe("Groceries"))
  })

  it("passes a renamed / custom name through verbatim", async () => {
    const { result } = renderHook(() => useCategoryDisplayName())
    await withLocale("ru", () => {
      expect(result.current("Продукты у бабушки")).toBe("Продукты у бабушки")
      expect(result.current("Groceries (old)")).toBe("Groceries (old)")
    })
  })
})

describe("useGroupDisplayName", () => {
  it("translates canonical groups and the Archived sentinel", async () => {
    const { result } = renderHook(() => useGroupDisplayName())
    await withLocale("ru", () => {
      expect(result.current("Daily Living")).toBe("Повседневные")
      expect(result.current("Archived")).toBe("Архив")
    })
  })

  it("passes a custom group through verbatim", async () => {
    const { result } = renderHook(() => useGroupDisplayName())
    await withLocale("ru", () => expect(result.current("Side Hustle")).toBe("Side Hustle"))
  })
})

describe("useAccountTypeLabel", () => {
  it("localizes each account type", async () => {
    const { result } = renderHook(() => useAccountTypeLabel())
    await withLocale("ru", () => {
      expect(result.current("credit_card")).toBe("Кредитная карта")
      expect(result.current("cash")).toBe("Наличные")
    })
    await withLocale("en", () => expect(result.current("credit_card")).toBe("Credit Card"))
  })
})
