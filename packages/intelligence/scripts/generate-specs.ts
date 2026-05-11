/**
 * Generate `src/specs.generated.ts` from the contents of `specs/*.md`.
 *
 * Runs as a `prebuild` step on the intelligence package; tests also call
 * `buildSpecsModule()` to verify the committed generated file is in sync
 * with the current sources.
 *
 * The generated file exports:
 *
 * - `SPECS` — { filename → file content } for every `specs/*.md` file.
 *   The `read_spec` tool reads this map directly; no runtime fs access.
 * - `SPEC_FILENAMES` — sorted array of available filenames.
 * - `PRODUCT_EXCERPT` — `PRODUCT.md` truncated at `## Target Platforms`.
 *   Embedded in the chat system prompt as always-on context. Capy
 *   doesn't need to know how the app is distributed, only how it works.
 *
 * `DATA_MODEL.md` is small and entirely relevant — the prompt embeds the
 * full file via `SPECS["DATA_MODEL.md"]`.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SPECS_DIR = join(HERE, "..", "..", "..", "specs")
export const DEFAULT_OUT_PATH = join(HERE, "..", "src", "specs.generated.ts")

/**
 * Cut PRODUCT.md off before the deployment/distribution section. Capy
 * needs the feature inventory and philosophy — not target platforms or
 * licensing. Keeps the always-on prompt context tight.
 */
export function curateProduct(raw: string): string {
  const marker = "## Target Platforms"
  const idx = raw.indexOf(marker)
  return idx === -1 ? raw.trimEnd() : raw.slice(0, idx).trimEnd()
}

export function buildSpecsModule(specsDir: string = DEFAULT_SPECS_DIR): string {
  const files = readdirSync(specsDir)
    .filter((name) => name.endsWith(".md"))
    .sort()

  const entries = files.map((name) => {
    const content = readFileSync(join(specsDir, name), "utf-8")
    return { name, content }
  })

  const productEntry = entries.find((e) => e.name === "PRODUCT.md")
  if (!productEntry) {
    throw new Error("PRODUCT.md not found in specs/")
  }
  const productExcerpt = curateProduct(productEntry.content)

  const specsEntries = entries
    .map((e) => `  ${JSON.stringify(e.name)}: ${JSON.stringify(e.content)},`)
    .join("\n")

  return `// AUTO-GENERATED FILE — do not edit by hand.
//
// Sourced from \`specs/*.md\` by \`scripts/generate-specs.ts\`. Run
// \`npm run prebuild -w @capybudget/intelligence\` (or any build) to
// refresh after editing a spec.
//
// SPECS: map of filename → full file content, consumed by the
//        \`read_spec\` tool.
// PRODUCT_EXCERPT: \`PRODUCT.md\` minus deployment/distribution; baked
//                  into the chat system prompt.

export const SPECS: Readonly<Record<string, string>> = Object.freeze({
${specsEntries}
})

export const SPEC_FILENAMES: readonly string[] = Object.freeze([
${files.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
])

export const PRODUCT_EXCERPT: string = ${JSON.stringify(productExcerpt)}
`
}

// Run as a script when invoked directly (npm prebuild hook).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const output = buildSpecsModule()
  writeFileSync(DEFAULT_OUT_PATH, output)
  console.log(`Wrote ${DEFAULT_OUT_PATH} (${output.length} bytes)`)
}
