import { describe, it, expect } from "vitest"
import { getToolLabel } from "@/lib/tool-labels"

describe("getToolLabel", () => {
  it("returns human label for known tools", () => {
    expect(getToolLabel("list_accounts")).toBe("Querying accounts")
    expect(getToolLabel("create_transaction")).toBe("Creating transaction")
  })

  it("returns raw name for unknown tools", () => {
    expect(getToolLabel("some_custom_tool")).toBe("some_custom_tool")
  })
})
