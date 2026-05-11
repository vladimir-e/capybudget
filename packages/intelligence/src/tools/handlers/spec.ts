/**
 * Read one of the app's spec docs.
 *
 * Spec content is bundled at build time (see `scripts/generate-specs.ts`)
 * and looked up by exact filename — no filesystem access at runtime, no
 * path resolution, no traversal surface. Unknown filenames return a
 * helpful error listing what's available so the model can self-correct.
 *
 * The chat system prompt already embeds `DATA_MODEL.md` and a curated
 * `PRODUCT.md` excerpt as always-on context. This tool is for the rest:
 * architecture deep-dives, the import flow, the roadmap.
 */

import { SPECS, SPEC_FILENAMES } from "../../specs.generated"

export async function handleReadSpec(args: Record<string, unknown>): Promise<string> {
  const filename = args.filename

  if (typeof filename !== "string" || !filename) {
    throw new Error(
      `Missing filename. Available specs: ${SPEC_FILENAMES.join(", ")}`,
    )
  }

  const content = SPECS[filename]
  if (content === undefined) {
    throw new Error(
      `Unknown spec '${filename}'. Available specs: ${SPEC_FILENAMES.join(", ")}`,
    )
  }
  return content
}
