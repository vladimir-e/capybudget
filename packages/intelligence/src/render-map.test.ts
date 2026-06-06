import { describe, it, expect } from "vitest"
import {
  buildRenderToolMap,
  REPORT_STATUS_TOOL_NAME,
  RENDER_FOLLOWUPS_TOOL_NAME,
} from "./render-map"

describe("buildRenderToolMap", () => {
  const map = buildRenderToolMap()

  it("turns report_status into a status block", () => {
    const block = map[REPORT_STATUS_TOOL_NAME]({ status: "Reading your March statement…" })
    expect(block).toEqual({ type: "status", text: "Reading your March statement…" })
  })

  it("trims surrounding whitespace on the status line", () => {
    const block = map[REPORT_STATUS_TOOL_NAME]({ status: "  Mapping accounts…  " })
    expect(block).toEqual({ type: "status", text: "Mapping accounts…" })
  })

  it("returns null for an empty or missing status (falls back to tool-activity)", () => {
    expect(map[REPORT_STATUS_TOOL_NAME]({ status: "   " })).toBeNull()
    expect(map[REPORT_STATUS_TOOL_NAME]({})).toBeNull()
    expect(map[REPORT_STATUS_TOOL_NAME]({ status: 42 })).toBeNull()
  })

  it("still builds the render_* family", () => {
    expect(map.render_table({ headers: ["a"], rows: [["1"]] })).toEqual({
      type: "table",
      headers: ["a"],
      rows: [["1"]],
    })
    expect(
      map[RENDER_FOLLOWUPS_TOOL_NAME]({ chips: [{ label: "x", prompt: "y" }] }),
    ).toEqual({ type: "followups", chips: [{ label: "x", prompt: "y" }] })
  })
})
