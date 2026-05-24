import { describe, it, expect } from "vitest"
import { extractErrorMessage } from "./error-message"

/**
 * The shapes below mirror what the Anthropic and OpenAI SDKs actually
 * construct in `APIError.generate()` — see
 *   node_modules/@anthropic-ai/sdk/core/error.js
 *   node_modules/openai/core/error.js
 * Anthropic stores the full response body in `.error`; OpenAI unwraps
 * the inner `error` field before passing it through.
 */
describe("extractErrorMessage", () => {
  it("pulls the inner message from an Anthropic APIError shape", () => {
    const err = makeError(400, "400 ...raw body...", {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    })

    expect(extractErrorMessage(err)).toEqual({
      status: 400,
      message:
        "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    })
  })

  it("pulls the message from an OpenAI APIError shape (unwrapped body)", () => {
    const err = makeError(429, "429 You exceeded your current quota", {
      type: "insufficient_quota",
      code: "insufficient_quota",
      message:
        "You exceeded your current quota, please check your plan and billing details.",
      param: null,
    })

    expect(extractErrorMessage(err)).toEqual({
      status: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details.",
    })
  })

  it("falls back to Error.message when the SDK error shape is unfamiliar", () => {
    const err = new Error("network blew up")
    expect(extractErrorMessage(err)).toEqual({ message: "network blew up" })
  })

  it("preserves status when present even if the body isn't recognizable", () => {
    const err = makeError(500, "500 server fart", undefined)
    expect(extractErrorMessage(err)).toEqual({
      status: 500,
      message: "500 server fart",
    })
  })

  it("stringifies non-Error throws", () => {
    expect(extractErrorMessage("just a string")).toEqual({ message: "just a string" })
    expect(extractErrorMessage(42)).toEqual({ message: "42" })
  })
})

function makeError(status: number, message: string, body: unknown): Error {
  const err = new Error(message) as Error & { status: number; error: unknown }
  err.status = status
  err.error = body
  return err
}
