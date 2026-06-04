import { SPEC_FILENAMES } from "../../specs.generated"

// ── read_spec ────────────────────────────────────────────────────
// Bundled spec docs (specs/*.md) — content is generated into
// specs.generated.ts at build time. Used when capy needs implementation
// detail beyond the always-on app-knowledge brief in the system prompt.

export const READ_SPEC_TOOL_DEF = {
  name: "read_spec",
  description:
    "Read one of Capy Budget's design specs for detail beyond the app-knowledge brief already in your prompt — exact CSV schemas (DATA_MODEL.md), the feature inventory (PRODUCT.md), the architecture, the import pipeline, or the intelligence internals.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filename: {
        type: "string",
        description: "Spec filename to read.",
        enum: [...SPEC_FILENAMES],
      },
    },
    required: ["filename"],
  },
} as const
