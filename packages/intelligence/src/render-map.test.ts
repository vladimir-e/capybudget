import { describe, it, expect } from "vitest"
import { buildRenderToolMap, validateRenderInput } from "./render-map"

const MAP = buildRenderToolMap()

describe("render builders — empty-data rejection", () => {
  it("render_table returns null when headers or rows are empty", () => {
    expect(MAP.render_table({ headers: [], rows: [["a"]] })).toBeNull()
    expect(MAP.render_table({ headers: ["A"], rows: [] })).toBeNull()
    expect(MAP.render_table({ headers: [], rows: [] })).toBeNull()
  })

  it("render_table builds with at least one header and one row", () => {
    expect(MAP.render_table({ headers: ["A"], rows: [["1"]] })).toEqual({
      type: "table",
      headers: ["A"],
      rows: [["1"]],
    })
  })

  it("render_chart returns null when data is empty", () => {
    expect(MAP.render_chart({ title: "x", type: "bar", data: [] })).toBeNull()
    expect(MAP.render_chart({ title: "x", type: "donut", data: [] })).toBeNull()
  })

  it("render_chart builds with data points", () => {
    const data = [{ label: "Food", value: 50 }]
    expect(MAP.render_chart({ title: "x", type: "bar", data })).toEqual({
      type: "bar-chart",
      title: "x",
      data,
    })
  })
})

describe("validateRenderInput", () => {
  it("returns null for valid input", () => {
    expect(
      validateRenderInput("render_followups", {
        chips: [{ label: "More", prompt: "Tell me more" }],
      }),
    ).toBeNull()
  })

  it("names the expected shape for malformed input", () => {
    expect(
      validateRenderInput("render_followups", { followups: "[]" }),
    ).toContain("render_followups expects {chips: [{label, prompt}, ...]}")
  })

  it("flags empty-data payloads as invalid", () => {
    expect(validateRenderInput("render_table", { headers: [], rows: [] })).toContain(
      "render_table expects",
    )
    expect(
      validateRenderInput("render_chart", { title: "x", type: "bar", data: [] }),
    ).toContain("render_chart expects")
  })

  it("returns null for render tools without a builder", () => {
    expect(validateRenderInput("render_anything", {})).toBeNull()
  })
})
