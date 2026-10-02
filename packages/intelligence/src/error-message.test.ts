import { describe, it, expect } from "vitest"
import { deadEndKind, extractErrorMessage, isDeadEnd, isRejectedRequest } from "./error-message"
import { UnreachableError } from "./structured"

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

describe("isRejectedRequest", () => {
  it("rejects a 4xx other than a rate limit", () => {
    expect(isRejectedRequest({ status: 400 })).toBe(true)
    expect(isRejectedRequest({ status: 413 })).toBe(true)
    expect(isRejectedRequest({ status: 429 })).toBe(false)
    expect(isRejectedRequest({ status: 500 })).toBe(false)
  })

  it("rejects a status-less error coded with anything but a transient code", () => {
    expect(isRejectedRequest({ code: "invalid_image" })).toBe(true)
    expect(isRejectedRequest({ code: "invalid_prompt" })).toBe(true)
  })

  it.each(["server_error", "rate_limit_exceeded", "vector_store_timeout"])("keeps a status-less %s error", (code) => {
    expect(isRejectedRequest({ code })).toBe(false)
  })

  it("does not reject an error with neither a status nor a string code", () => {
    expect(isRejectedRequest({ code: null })).toBe(false)
    expect(isRejectedRequest(new Error("socket hang up"))).toBe(false)
    expect(isRejectedRequest("boom")).toBe(false)
    expect(isRejectedRequest(null)).toBe(false)
  })

  it("lets the status decide over the code", () => {
    expect(isRejectedRequest({ status: 500, code: "invalid_image" })).toBe(false)
    expect(isRejectedRequest({ status: 400, code: "server_error" })).toBe(true)
  })
})

function makeError(status: number, message: string, body: unknown): Error {
  const err = new Error(message) as Error & { status: number; error: unknown }
  err.status = status
  err.error = body
  return err
}

describe("deadEndKind / isDeadEnd", () => {
  it.each([
    [401, "keyRejected"],
    [403, "forbidden"],
    [404, "modelNotFound"],
  ] as const)("names a %i as a dead end", (status, kind) => {
    const err = Object.assign(new Error(`${status}`), { status })
    expect(deadEndKind(err)).toBe(kind)
    expect(isDeadEnd(err)).toBe(true)
  })

  it("counts an unreachable provider", () => {
    const err = new UnreachableError("Can't reach Ollama at http://localhost:11434")
    expect(deadEndKind(err)).toBe("unreachable")
    expect(isDeadEnd(err)).toBe(true)
  })

  it.each([429, 500])("leaves a %i to a later call", (status) => {
    const err = Object.assign(new Error(`${status}`), { status })
    expect(deadEndKind(err)).toBeNull()
    expect(isDeadEnd(err)).toBe(false)
  })

  it("leaves an error without a status alone", () => {
    expect(isDeadEnd(new Error("boom"))).toBe(false)
  })
})
