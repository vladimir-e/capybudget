import { describe, it, expect, beforeEach } from "vitest"
import { flagReopenFailure, consumeReopenFailure } from "./reopen-failure"

beforeEach(() => {
  consumeReopenFailure()
})

describe("reopen-failure", () => {
  it("returns null when nothing is pending", () => {
    expect(consumeReopenFailure()).toBeNull()
  })

  it("returns the flagged failure once, then null", () => {
    flagReopenFailure({ path: "/b", name: "Budget" })
    expect(consumeReopenFailure()).toEqual({ path: "/b", name: "Budget" })
    expect(consumeReopenFailure()).toBeNull()
  })

  it("keeps only the most recent flag", () => {
    flagReopenFailure({ path: "/a", name: "A" })
    flagReopenFailure({ path: "/b", name: "B" })
    expect(consumeReopenFailure()).toEqual({ path: "/b", name: "B" })
  })
})
