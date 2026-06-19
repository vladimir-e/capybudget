import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LanguageSection } from "./language-section"

// Picker behavior is covered in language-select.test.tsx; this only asserts the
// section chrome, so mock out the one side effect.
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
