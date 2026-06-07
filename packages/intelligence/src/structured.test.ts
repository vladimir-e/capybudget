import { describe, it, expect } from "vitest"
import { parseStructured, SchemaValidationError } from "./structured"
import type { JsonSchema } from "./structured"

const ROWS_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          amount: { type: "number" },
          type: { type: "string", enum: ["debit", "credit"] },
        },
        required: ["date", "amount", "type"],
      },
    },
  },
  required: ["rows"],
}

// The discriminated outcome the mapping/extraction call returns: rows, or an error.
const OUTCOME_SCHEMA: JsonSchema = {
  anyOf: [
    ROWS_SCHEMA,
    {
      type: "object",
      properties: {
        error: { type: "string", enum: ["no_data"] },
        message: { type: "string" },
      },
      required: ["error", "message"],
    },
  ],
}

describe("parseStructured", () => {
  it("parses and returns a value that satisfies the schema", () => {
    const text = JSON.stringify({
      rows: [{ date: "2026-01-01", amount: 12.5, type: "debit" }],
    })
    const result = parseStructured<{ rows: unknown[] }>(text, ROWS_SCHEMA)
    expect(result.rows).toHaveLength(1)
  })

  it("throws on text that is not valid JSON", () => {
    expect(() => parseStructured("not json{", ROWS_SCHEMA)).toThrow(
      SchemaValidationError,
    )
  })

  it("throws when a required property is missing", () => {
    const text = JSON.stringify({})
    expect(() => parseStructured(text, ROWS_SCHEMA)).toThrowError(/rows.*required/i)
  })

  it("throws when a nested array element has the wrong type", () => {
    const text = JSON.stringify({
      rows: [{ date: "2026-01-01", amount: "oops", type: "debit" }],
    })
    expect(() => parseStructured(text, ROWS_SCHEMA)).toThrowError(
      /rows\[0\]\.amount.*number/i,
    )
  })

  it("throws when an enum value is not allowed", () => {
    const text = JSON.stringify({
      rows: [{ date: "2026-01-01", amount: 1, type: "transfer" }],
    })
    expect(() => parseStructured(text, ROWS_SCHEMA)).toThrowError(/enum/i)
  })

  it("validates the rows branch of a discriminated outcome", () => {
    const text = JSON.stringify({
      rows: [{ date: "2026-01-01", amount: 1, type: "credit" }],
    })
    const result = parseStructured<{ rows: unknown[] }>(text, OUTCOME_SCHEMA)
    expect(result.rows).toBeDefined()
  })

  it("validates the error branch of a discriminated outcome", () => {
    const text = JSON.stringify({ error: "no_data", message: "It's a selfie." })
    const result = parseStructured<{ error: string }>(text, OUTCOME_SCHEMA)
    expect(result.error).toBe("no_data")
  })

  it("throws when a value matches no anyOf alternative", () => {
    const text = JSON.stringify({ unexpected: true })
    expect(() => parseStructured(text, OUTCOME_SCHEMA)).toThrowError(/anyOf/i)
  })

  it("ignores extra properties not described by the schema", () => {
    const text = JSON.stringify({
      rows: [{ date: "x", amount: 1, type: "debit", extra: "ok" }],
    })
    expect(() => parseStructured(text, ROWS_SCHEMA)).not.toThrow()
  })

  it("accepts a top-level schema with no type as unconstrained", () => {
    expect(parseStructured("42", {})).toBe(42)
    expect(parseStructured('"hi"', {})).toBe("hi")
  })
})
