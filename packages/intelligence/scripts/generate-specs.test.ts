/**
 * Verifies that the committed `src/specs.generated.ts` is in sync with
 * the current `specs/*.md` sources. If this test fails after editing a
 * spec, run `npm run generate:specs` and commit the regenerated file.
 */

import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import { buildSpecsModule, DEFAULT_OUT_PATH, EXCLUDED_SPECS } from "./generate-specs"

describe("generate-specs", () => {
  it("committed specs.generated.ts is up to date with specs/*.md", () => {
    const expected = buildSpecsModule()
    const actual = readFileSync(DEFAULT_OUT_PATH, "utf-8")
    expect(actual).toBe(expected)
  })

  it("keeps contributor-only specs out of the shipped bundle", () => {
    const output = buildSpecsModule()
    for (const name of EXCLUDED_SPECS) {
      expect(output).not.toContain(JSON.stringify(name))
    }
  })
})
