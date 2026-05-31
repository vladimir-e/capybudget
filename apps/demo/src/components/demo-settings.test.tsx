import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ProviderSection } from "@/components/settings/provider-section"

// Runs under the demo vite config, so __IS_DEMO__ is true here.

afterEach(cleanup)

describe("ProviderSection in the demo", () => {
  it("shows the desktop-only notice", () => {
    render(<ProviderSection />)
    expect(
      screen.getByText("AI is only available in the desktop app"),
    ).toBeInTheDocument()
  })

  it("disables every provider radio", () => {
    render(<ProviderSection />)
    const radios = screen.getAllByRole("radio")
    expect(radios.length).toBe(4)
    // base-ui marks a disabled radio with data-disabled rather than the
    // native disabled attribute.
    for (const radio of radios) {
      expect(radio).toHaveAttribute("data-disabled")
    }
  })

  it("does not render any per-provider config (no API key field)", () => {
    render(<ProviderSection />)
    expect(screen.queryByText("API key")).not.toBeInTheDocument()
  })
})
