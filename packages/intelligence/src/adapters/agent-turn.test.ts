import { describe, it, expect } from "vitest"
import { FALLBACK_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS, TurnDisplay, clampedOutputCap } from "./agent-turn"
import type { ContentBlock } from "../types"

function anthropicError(message: string, status = 400) {
  const err = new Error(`${status} ${message}`) as Error & { status: number; error: unknown }
  err.status = status
  err.error = { type: "error", error: { type: "invalid_request_error", message } }
  return err
}

function openAiError(message: string, param = "max_tokens") {
  const err = new Error(`400 ${message}`) as Error & { status: number; error: unknown }
  err.status = 400
  err.error = { type: "invalid_request_error", code: null, message, param }
  return err
}

function rawError(message: string) {
  return Object.assign(new Error(message), { status: 400 })
}

describe("clampedOutputCap", () => {
  it.each([
    [
      "Anthropic limit, ignoring the digits in the model name",
      anthropicError(
        "max_tokens: 32000 > 8192, which is the maximum allowed number of output tokens for claude-3-5-haiku-20241022",
      ),
      8192,
    ],
    [
      "OpenAI limit",
      openAiError(
        "max_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000.",
      ),
      16384,
    ],
    [
      "OpenAI Responses limit",
      openAiError(
        "max_output_tokens is too large: 32000. This model supports at most 16384 output tokens, whereas you provided 32000.",
        "max_output_tokens",
      ),
      16384,
    ],
    [
      "OpenAI Responses limit worded as completion tokens",
      openAiError(
        "max_output_tokens is too large: 32000. This model supports at most 16384 completion tokens, whereas you provided 32000.",
        "max_output_tokens",
      ),
      16384,
    ],
    [
      "OpenAI Responses parameter bound",
      openAiError(
        "Invalid 'max_output_tokens': integer above maximum value. Expected a value <= 16384, but got 32000 instead.",
        "max_output_tokens",
      ),
      16384,
    ],
    [
      "a limit with a thousands separator",
      openAiError("max_completion_tokens is too large: 32,000. This model supports at most 16,384 completion tokens."),
      16384,
    ],
    [
      "a leading HTTP status on an unparsed body",
      rawError(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: 32000 > 4096, which is the maximum allowed number of output tokens for claude-3-haiku-20240307"}}',
      ),
      4096,
    ],
    [
      "a context-window overflow",
      anthropicError(
        "input length and `max_tokens` exceed context limit: 197000 + 32000 > 200000, decrease input length or `max_tokens` and try again",
      ),
      null,
    ],
    ["a cap error that names no number", anthropicError("max_tokens is too large for this model"), FALLBACK_OUTPUT_TOKENS],
    ["an implausibly small limit", anthropicError("max_tokens: 32000 > 400, which is the maximum allowed"), null],
    ["an unrelated 400", anthropicError("messages: roles must alternate"), null],
    ["a cap message on a non-400", anthropicError("max_tokens: 32000 > 8192", 500), null],
  ])("%s", (_label, err, expected) => {
    expect(clampedOutputCap(err, MAX_OUTPUT_TOKENS)).toBe(expected)
  })

  it("never raises the cap", () => {
    expect(clampedOutputCap(anthropicError("max_tokens: 8192 > 16000, which is the maximum"), 8192)).toBeNull()
    expect(clampedOutputCap(anthropicError("max_tokens is too large"), FALLBACK_OUTPUT_TOKENS)).toBeNull()
  })
})

describe("TurnDisplay.settle", () => {
  function recordingDisplay() {
    const published: ContentBlock[][] = []
    return { display: new TurnDisplay((blocks) => published.push(blocks)), published }
  }

  it("trims from the first unrun call, dropping the text after it", () => {
    const { display, published } = recordingDisplay()
    display.beginIteration()
    display.appendText("Looking")
    display.addCall("a", { type: "tool-activity", tool: "first" })
    display.addCall("b", { type: "tool-activity", tool: "second" })
    display.appendText("After")
    display.addCall("c", { type: "tool-activity", tool: "third" })
    display.markStarted("a")
    display.markStarted("c")

    display.settle()

    expect(published.at(-1)).toEqual([
      { type: "text", content: "Looking" },
      { type: "tool-activity", tool: "first" },
    ])
  })

  it("leaves a display whose calls all ran untouched, and publishes nothing after settling", () => {
    const { display, published } = recordingDisplay()
    display.beginIteration()
    display.addCall("a", { type: "tool-activity", tool: "first" })
    display.appendText("Done")
    display.markStarted("a")
    const before = published.length

    display.settle()
    display.appendText(" more")

    expect(published).toHaveLength(before)
  })
})
