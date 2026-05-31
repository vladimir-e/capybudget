import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MobileNotice } from "./mobile-notice"

afterEach(cleanup)

describe("MobileNotice", () => {
  // Safety-critical: this strip shows on phones, where landing an installer
  // would be useless. The link must point at the promo site's root, never a
  // downloadable binary — asserted as the bare promo origin with no path that
  // could resolve to a .dmg/.msi/release asset.
  it("links to the promo site root, not a downloadable installer", () => {
    render(<MobileNotice />)
    const link = screen.getByRole("link", { name: /get the desktop app/i })
    const href = link.getAttribute("href") ?? ""
    const url = new URL(href)

    expect(href).toBe("https://capybudget.app")
    expect(url.host).toBe("capybudget.app")
    expect(url.pathname).toBe("/")
    expect(url.search).toBe("")
  })

  it("opens the link safely in a new tab", () => {
    render(<MobileNotice />)
    const link = screen.getByRole("link", { name: /get the desktop app/i })

    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })
})
