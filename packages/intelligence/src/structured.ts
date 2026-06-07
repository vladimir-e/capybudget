/**
 * Stateless structured-output primitive shared by the in-process API
 * adapters (Anthropic, OpenAI). One constrained model call returns a
 * value the caller's JSON Schema describes — no agent loop, no tools.
 *
 * Both providers constrain generation to the schema server-side
 * (Anthropic `output_config.format`, OpenAI `response_format` json_schema).
 * `parseStructured` is the client-side enforcement layer: it parses the
 * returned text and checks it against the same schema, so a malformed or
 * off-schema response surfaces as a thrown error at the call site rather
 * than as a silently-wrong object downstream.
 */

import type { MessageContent } from "./types"

/**
 * A user or assistant turn. Only user turns may carry non-text content:
 * Anthropic 400s on image/document blocks in an assistant turn, so the
 * type forbids what the API would reject. Receipt images and document
 * bytes ride the user channel (`MessageContent`); assistant turns (e.g.
 * few-shot examples) are text-only.
 */
export type StructuredMessage =
  | { role: "user"; content: MessageContent }
  | { role: "assistant"; content: string }

export interface StructuredSession {
  /**
   * One constrained model call, parsed and schema-validated. No agent
   * loop, no tools. Rejects with `SchemaValidationError` on invalid JSON
   * or a schema mismatch, with the provider's error otherwise.
   */
  structured<T = unknown>(
    messages: readonly StructuredMessage[],
    schema: JsonSchema,
  ): Promise<T>
}

/**
 * The JSON Schema subset structured-output schemas use. `additionalProperties`
 * and other unlisted keywords are accepted in the payload (the index
 * signature) but not enforced client-side — extras on validated values
 * always pass, by design (the providers constrain the shape, this is the
 * backstop). `anyOf` is assumed the sole keyword at its node.
 */
export type JsonSchema = {
  readonly type?:
    | "object"
    | "array"
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "null"
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchema
  readonly enum?: ReadonlyArray<unknown>
  readonly anyOf?: ReadonlyArray<JsonSchema>
  readonly [key: string]: unknown
}

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SchemaValidationError"
  }
}

export function parseStructured<T>(text: string, schema: JsonSchema): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new SchemaValidationError(
      `structured output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const error = validate(parsed, schema, "$")
  if (error) throw new SchemaValidationError(error)
  return parsed as T
}

function validate(value: unknown, schema: JsonSchema, path: string): string | null {
  // anyOf is the sole keyword at its node — sibling type/required/etc. on
  // the same node are not evaluated. True for every schema we emit; a node
  // that combined them would need the early return removed.
  if (schema.anyOf) {
    const matched = schema.anyOf.some((sub) => validate(value, sub, path) === null)
    if (!matched) return `${path}: value matched none of the anyOf alternatives`
    return null
  }

  if (schema.enum) {
    const ok = schema.enum.some((allowed) => deepEqual(allowed, value))
    if (!ok) return `${path}: value is not one of the allowed enum values`
  }

  switch (schema.type) {
    case undefined:
      return null
    case "null":
      return value === null ? null : `${path}: expected null`
    case "boolean":
      return typeof value === "boolean" ? null : `${path}: expected boolean`
    case "string":
      return typeof value === "string" ? null : `${path}: expected string`
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${path}: expected number`
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `${path}: expected integer`
    case "array":
      return validateArray(value, schema, path)
    case "object":
      return validateObject(value, schema, path)
  }
}

function validateArray(value: unknown, schema: JsonSchema, path: string): string | null {
  if (!Array.isArray(value)) return `${path}: expected array`
  if (!schema.items) return null
  for (let i = 0; i < value.length; i++) {
    const error = validate(value[i], schema.items, `${path}[${i}]`)
    if (error) return error
  }
  return null
}

function validateObject(value: unknown, schema: JsonSchema, path: string): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${path}: expected object`
  }
  const obj = value as Record<string, unknown>
  for (const key of schema.required ?? []) {
    if (!(key in obj)) return `${path}.${key}: required property is missing`
  }
  if (schema.properties) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in obj) {
        const error = validate(obj[key], subSchema, `${path}.${key}`)
        if (error) return error
      }
    }
  }
  return null
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((el, i) => deepEqual(el, b[i]))
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as object)
    const bKeys = Object.keys(b as object)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  }
  return false
}
