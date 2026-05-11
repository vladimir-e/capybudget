/**
 * Verifies that the committed `src/specs.generated.ts` is in sync with
 * the current `specs/*.md` sources. If this test fails after editing a
 * spec, run `npm run generate:specs` and commit the regenerated file.
 *
 * Also exercises the curation logic so the test catches a regression
 * even if no one runs the script.
 */

import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
  buildSpecsModule,
  curateProduct,
  DEFAULT_OUT_PATH,
} from "./generate-specs"

describe("generate-specs", () => {
  it("committed specs.generated.ts is up to date with specs/*.md", () => {
    const expected = buildSpecsModule()
    const actual = readFileSync(DEFAULT_OUT_PATH, "utf-8")
    expect(actual).toBe(expected)
  })

  describe("curateProduct", () => {
    it("drops everything from '## Target Platforms' onward", () => {
      const raw = [
        "# Product Vision",
        "",
        "Capy is great.",
        "",
        "## Key Features",
        "",
        "Lots of them.",
        "",
        "## Target Platforms",
        "",
        "macOS first.",
      ].join("\n")
      const curated = curateProduct(raw)
      expect(curated).toContain("Key Features")
      expect(curated).toContain("Lots of them.")
      expect(curated).not.toContain("Target Platforms")
      expect(curated).not.toContain("macOS first.")
    })

    it("leaves files without the cutoff marker intact", () => {
      const raw = "# Product Vision\n\nNothing to cut.\n"
      expect(curateProduct(raw)).toBe(raw.trimEnd())
    })
  })
})
