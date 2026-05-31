import { SPEC_FILENAMES } from "../../specs.generated"

// ── read_spec ────────────────────────────────────────────────────
// Bundled spec docs (specs/*.md) — content is generated into
// specs.generated.ts at build time. Used when capy needs implementation
// detail beyond what the system prompt already embeds.

export const READ_SPEC_TOOL_DEF = {
  name: "read_spec",
  description: `Read one of Capy Budget's design specs. The chat prompt already embeds DATA_MODEL.md and a high-level PRODUCT.md excerpt — reach for this tool when you need deeper detail on architecture, the import pipeline, or the intelligence layer internals. Available files: ${SPEC_FILENAMES.join(", ")}.`,
  inputSchema: {
    type: "object" as const,
    properties: {
      filename: {
        type: "string",
        description: `Spec filename, e.g. 'ARCHITECTURE.md'. Must be one of: ${SPEC_FILENAMES.join(", ")}.`,
        enum: [...SPEC_FILENAMES],
      },
    },
    required: ["filename"],
  },
} as const
