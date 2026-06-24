import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { i18n } from "@capybudget/i18n"
import { LanguageSelect } from "./language-select"

// Keep the real i18n so the picker renders with real endonym labels; spy only
// on setLocale, the one side effect.
const { setLocaleMock } = vi.hoisted(() => ({ setLocaleMock: vi.fn() }))

vi.mock("@capybudget/i18n", async (importActual) => {
  const actual = await importActual<typeof import("@capybudget/i18n")>()
  return { ...actual, setLocale: setLocaleMock }
})

beforeEach(() => {
  setLocaleMock.mockClear()
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("en")
})

describe("LanguageSelect", () => {
  it("shows the active code and endonym in the closed trigger for both locales", async () => {
    const { rerender } = render(<LanguageSelect />)
    expect(screen.getByRole("combobox")).toHaveTextContent("EN · English")

    await i18n.changeLanguage("ru")
    rerender(<LanguageSelect />)
    expect(screen.getByRole("combobox")).toHaveTextContent("RU · Русский")
  })

  it("lists every supported language by its code and endonym", async () => {
    const user = userEvent.setup()
    render(<LanguageSelect />)

    await user.click(screen.getByRole("combobox"))
    const listbox = await screen.findByRole("listbox")
    expect(within(listbox).getByRole("option", { name: "EN · English" })).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: "ES · Español" })).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: "RU · Русский" })).toBeInTheDocument()
  })

  it("applies the chosen language through setLocale", async () => {
    const user = userEvent.setup()
    render(<LanguageSelect />)

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "RU · Русский" }))

    expect(setLocaleMock).toHaveBeenCalledWith("ru")
  })
})
