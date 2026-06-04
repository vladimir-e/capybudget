// ── Render tool schemas ──────────────────────────────────────────
// These are no-ops on the dispatch side — the frontend intercepts the
// tool_use events and renders the corresponding UI components.

export const RENDER_TOOL_DEFS = [
  {
    name: "render_table",
    description:
      "Render a data table in the UI. Use this instead of markdown tables. The frontend will display it as a styled, interactive table.",
    inputSchema: {
      type: "object" as const,
      properties: {
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Column header labels",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description:
            "Table rows. Each row is an array of cell strings. Prefix amounts with $ for formatting.",
        },
      },
      required: ["headers", "rows"],
    },
  },
  {
    name: "render_chart",
    description:
      "Render a chart in the UI. `type: \"bar\"` draws a horizontal bar chart (comparing values across categories); `type: \"donut\"` draws a donut chart (proportions and distributions).",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Chart title" },
        type: {
          type: "string",
          enum: ["bar", "donut"],
          description: "Chart style: 'bar' for comparisons, 'donut' for proportions.",
        },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "number" },
            },
            required: ["label", "value"],
          },
          description: "Data points. Values should be positive numbers (dollars, not cents).",
        },
      },
      required: ["title", "type", "data"],
    },
  },
  {
    name: "render_followups",
    description:
      "Render 2-3 follow-up suggestion chips below the response. Each chip has a short label (button text) and a prompt (sent as the user's next message when clicked). Use for natural follow-up questions or related views.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chips: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Short button text (3-5 words)",
              },
              prompt: {
                type: "string",
                description:
                  "The full prompt sent as the user's next message when the chip is clicked",
              },
            },
            required: ["label", "prompt"],
          },
          description: "1-4 follow-up chips, ideally 2-3.",
        },
      },
      required: ["chips"],
    },
  },
] as const
