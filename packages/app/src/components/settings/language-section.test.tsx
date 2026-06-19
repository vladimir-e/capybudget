import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LanguageSection } from "./language-section"

// Keep the real i18n (so the picker renders, hooks resolve, and the endonym
// labels come from SUPPORTED_LOCALES) but spy on setLocale — that's the one
// side effect, and under the hood it persists + calls i18next.changeLanguage.
const { setLocaleMock } = vi.hoisted(() => ({ setLocaleMock: vi.fn() }))

vi.mock("@capybudget/i18n", async (importActual) => {
  const actual = await importActual<typeof import("@capybudget/i18n")>()
  return { ...actual, setLocale: setLocaleMock }
})

beforeEach(() => {
  setLocaleMock.mockClear()
})

afterEach(cleanup)

describe("LanguageSection", () => {
  it("renders the supported languages by their endonym", async () => {
    const user = userEvent.setup()
    render(<LanguageSection />)

    await user.click(screen.getByLabelText("Language"))

    expect(await screen.findByRole("option", { name: "English" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Русский" })).toBeInTheDocument()
  })

  it("applies the chosen language through setLocale", async () => {
    const user = userEvent.setup()
    render(<LanguageSection />)

    await user.click(screen.getByLabelText("Language"))
    await user.click(await screen.findByRole("option", { name: "Русский" }))

    expect(setLocaleMock).toHaveBeenCalledWith("ru")
  })
})
