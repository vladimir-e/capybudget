import { SPEC_FILENAMES } from "../../specs.generated"

// ── read_spec ────────────────────────────────────────────────────
// Bundled spec docs (specs/*.md) — content is generated into
// specs.generated.ts at build time. Used when capy needs implementation
// detail beyond the always-on app-knowledge brief in the system prompt.

export const READ_SPEC_TOOL_DEF = {
  name: "read_spec",
  description: `Read one of Capy Budget's design specs. The prompt already embeds the app-knowledge guide (the working model + your role); reach for this tool for deeper detail — exact CSV schemas in DATA_MODEL.md, the full feature inventory in PRODUCT.md, the architecture, the import pipeline, or the intelligence layer internals. Available files: ${SPEC_FILENAMES.join(", ")}.`,
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
