import { describe, it, expect } from "vitest"
import { i18n } from "@capybudget/i18n"
import { getToolLabel } from "@/lib/tool-labels"

const t = i18n.getFixedT("en", "capy")

describe("getToolLabel", () => {
  it("returns human label for known tools", () => {
    expect(getToolLabel("list_accounts", t)).toBe("Querying accounts")
    expect(getToolLabel("create_transaction", t)).toBe("Creating transaction")
  })

  it("labels the ToolSearch CLI built-in", () => {
    expect(getToolLabel("ToolSearch", t)).toBe("Looking up tools")
  })

  it("returns raw name for unknown tools", () => {
    expect(getToolLabel("some_custom_tool", t)).toBe("some_custom_tool")
  })
})
