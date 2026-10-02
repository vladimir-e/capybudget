import { describe, expect, it } from "vitest"
import { billingCtaUrl } from "./billing-cta"

describe("billingCtaUrl", () => {
  it("links OpenAI's exhausted-quota 429 to its billing page", () => {
    expect(
      billingCtaUrl({ type: "error", status: 429, provider: "openai", message: "You exceeded your current quota." }),
    ).toBe("https://platform.openai.com/account/billing")
  })

  it("offers no billing link for a plain rate limit", () => {
    expect(
      billingCtaUrl({ type: "error", status: 429, provider: "anthropic", message: "Anthropic API is rate-limiting requests right now." }),
    ).toBeNull()
  })
})
