import { describe, expect, it } from "vitest"
import type { ReactNode } from "react"
import { renderHook } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { i18n } from "@capybudget/i18n"
import { useScenarioLabels } from "./labels"
import { PROFILE_LIST } from "."

/** Isolated translator fixed to one language, so a case never mutates the
 *  shared instance. Mirrors the app's display-name tests. */
function localeWrapper(locale: string) {
  const scoped = i18n.cloneInstance({ lng: locale })
  return ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={scoped}>{children}</I18nextProvider>
  )
}

describe("useScenarioLabels", () => {
  it("renders the scenario picker copy in Russian under ru", () => {
    const { result } = renderHook(() => useScenarioLabels(), {
      wrapper: localeWrapper("ru"),
    })
    const underwater = PROFILE_LIST.find((p) => p.id === "underwater")!
    const labels = result.current(underwater)

    expect(labels.name).toBe("На дне")
    expect(labels.description).toBe("Много долгов, отрицательный капитал, баланс уходит в минус")
  })

  it("localizes name and description for every shipped profile", () => {
    const en = renderHook(() => useScenarioLabels(), { wrapper: localeWrapper("en") })
    const ru = renderHook(() => useScenarioLabels(), { wrapper: localeWrapper("ru") })

    for (const profile of PROFILE_LIST) {
      // Each profile resolves to real catalog copy, distinct per locale — never
      // the bare key falling through.
      const enLabels = en.result.current(profile)
      const ruLabels = ru.result.current(profile)
      expect(enLabels.name).not.toContain("scenarios.")
      expect(ruLabels.name).not.toContain("scenarios.")
      expect(ruLabels.name).not.toBe(enLabels.name)
      expect(ruLabels.description).not.toBe(enLabels.description)
    }
  })
})
