import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ImportNotice } from "./import-notice"

afterEach(cleanup)

describe("ImportNotice", () => {
  it("tells the visitor Smart Import is desktop-only", () => {
    render(<ImportNotice />)
    expect(
      screen.getByText(/smart import is only available in the desktop app/i),
    ).toBeInTheDocument()
  })

  // Same link-safety contract as MobileNotice: point at the promo root, never
  // a downloadable installer, and open it in a safely-rel'd new tab.
  it("links to the promo site root in a new tab", () => {
    render(<ImportNotice />)
    const link = screen.getByRole("link", { name: /get the desktop app/i })

    expect(link.getAttribute("href")).toBe("https://capybudget.app")
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })
})
