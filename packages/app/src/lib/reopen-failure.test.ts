import { describe, it, expect, beforeEach } from "vitest"
import { flagReopenFailure, consumeReopenFailure } from "./reopen-failure"

beforeEach(() => {
  consumeReopenFailure()
})

describe("reopen-failure", () => {
  it("returns null when nothing is pending", () => {
    expect(consumeReopenFailure()).toBeNull()
  })

  it("returns the flagged name once, then null", () => {
    flagReopenFailure("Budget")
    expect(consumeReopenFailure()).toBe("Budget")
    expect(consumeReopenFailure()).toBeNull()
  })

  it("keeps only the most recent flag", () => {
    flagReopenFailure("A")
    flagReopenFailure("B")
    expect(consumeReopenFailure()).toBe("B")
  })
})
