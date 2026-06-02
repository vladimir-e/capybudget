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
 *   The chat / import / enrich prompts embed `SPECS["APP_KNOWLEDGE.md"]`
 *   as the shared always-on brief; the rest are reachable via `read_spec`.
 * - `SPEC_FILENAMES` — sorted array of available filenames.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SPECS_DIR = join(HERE, "..", "..", "..", "specs")
export const DEFAULT_OUT_PATH = join(HERE, "..", "src", "specs.generated.ts")

export function buildSpecsModule(specsDir: string = DEFAULT_SPECS_DIR): string {
  const files = readdirSync(specsDir)
    .filter((name) => name.endsWith(".md"))
    .sort()

  const entries = files.map((name) => {
    const content = readFileSync(join(specsDir, name), "utf-8")
    return { name, content }
  })

  const specsEntries = entries
    .map((e) => `  ${JSON.stringify(e.name)}: ${JSON.stringify(e.content)},`)
    .join("\n")

  return `// AUTO-GENERATED FILE — do not edit by hand.
//
// Sourced from \`specs/*.md\` by \`scripts/generate-specs.ts\`. Run
// \`npm run prebuild -w @capybudget/intelligence\` (or any build) to
// refresh after editing a spec.
//
// SPECS: map of filename → full file content. Consumed by the
//        \`read_spec\` tool, and by the chat / import / enrich prompts
//        which embed \`APP_KNOWLEDGE.md\` as the shared always-on brief.

export const SPECS: Readonly<Record<string, string>> = Object.freeze({
${specsEntries}
})

export const SPEC_FILENAMES: readonly string[] = Object.freeze([
${files.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
])
`
}

// Run as a script when invoked directly (npm prebuild hook).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const output = buildSpecsModule()
  writeFileSync(DEFAULT_OUT_PATH, output)
  console.log(`Wrote ${DEFAULT_OUT_PATH} (${output.length} bytes)`)
}
