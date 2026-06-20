import { afterEach, describe, expect, it, vi } from "vitest"
import { enUS, enGB, es, ru } from "react-day-picker/locale"

import { resolveCalendarLocale } from "./calendar-locale"

describe("resolveCalendarLocale", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("week start derives from the region", () => {
    it.each([
      ["es-ES", 1],
      ["es-MX", 0],
      ["es-US", 0],
      ["en-US", 0],
      ["en-GB", 1],
      ["ru", 1],
      ["ru-RU", 1],
      ["es", 1],
      ["en", 0],
    ])("%s → weekStartsOn %i", (tag, expected) => {
      expect(resolveCalendarLocale(tag).weekStartsOn).toBe(expected)
    })
  })

  describe("name locale object derives from the base language", () => {
    it.each([
      ["en-GB", enGB],
      ["en-US", enUS],
      ["en", enUS],
      ["es-MX", es],
      ["es-ES", es],
      ["es", es],
      ["ru-RU", ru],
      ["ru", ru],
      ["fr-FR", enUS],
    ])("%s → %s", (tag, expected) => {
      expect(resolveCalendarLocale(tag).locale).toBe(expected)
    })
  })

  it("es-MX and es-ES share the es name object but differ in week start", () => {
    const mx = resolveCalendarLocale("es-MX")
    const esES = resolveCalendarLocale("es-ES")
    expect(mx.locale).toBe(es)
    expect(esES.locale).toBe(es)
    expect(mx.weekStartsOn).toBe(0)
    expect(esES.weekStartsOn).toBe(1)
  })

  it("falls back to the name locale's default when Intl week info throws", () => {
    vi.spyOn(globalThis.Intl, "Locale").mockImplementation(function () {
      throw new Error("Intl.Locale unavailable")
    } as unknown as typeof Intl.Locale)
    // es default (Spain) is Monday; the region path is gone, so we get the language default.
    expect(resolveCalendarLocale("es-MX").weekStartsOn).toBe(1)
    expect(resolveCalendarLocale("en-GB").weekStartsOn).toBe(enGB.options?.weekStartsOn)
    expect(resolveCalendarLocale("en-US").weekStartsOn).toBe(enUS.options?.weekStartsOn)
  })
})
