import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LanguageSection } from "./language-section"

// setLocale is the section's only side effect; the picker behavior itself is
// covered in language-select.test.tsx. Here we only assert the section chrome
// and that it embeds a working, endonym-labelled picker.
vi.mock("@capybudget/i18n", async (importActual) => {
  const actual = await importActual<typeof import("@capybudget/i18n")>()
  return { ...actual, setLocale: vi.fn() }
})

afterEach(cleanup)

describe("LanguageSection", () => {
  it("renders the language card with its picker", () => {
    render(<LanguageSection />)

    expect(screen.getByText("Language")).toBeInTheDocument()
    expect(
      screen.getByText("Display language for the app."),
    ).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveTextContent("English")
  })
})
