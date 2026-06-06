/**
 * Tool-call → ContentBlock mapping.
 *
 * Shared by every adapter (Claude CLI, Anthropic API, OpenAI API). Some
 * tools are communication channels, not data calls — the model emits them
 * and the UI renders the result rather than feeding a string back to the
 * model. Chat's `render_*` family (tables, charts, follow-ups) and import's
 * `report_status` line all work this way, so each adapter routes them
 * through the same builders here. Single source of truth — adding such a
 * tool means adding it to its definitions file + here, nowhere else.
 *
 * Each builder validates the parsed tool input. If the payload is
 * malformed (model misbehavior), the builder returns `null` and the
 * adapter falls back to a `tool-activity` block — the session keeps moving
 * rather than crashing the renderer.
 */
import type {
  BarChartBlock,
  ContentBlock,
  DonutChartBlock,
  FollowupChip,
  FollowupsBlock,
  StatusBlock,
  TableBlock,
} from "./types"

// Terminal-signal tool contract — see specs/INTELLIGENCE.md.
export const RENDER_FOLLOWUPS_TOOL_NAME = "render_followups"

// Import progress channel — see specs/INTELLIGENCE.md § Import Sessions.
export const REPORT_STATUS_TOOL_NAME = "report_status"

type RenderBuilder = (input: Record<string, unknown>) => ContentBlock | null

const BUILDERS: Record<string, RenderBuilder> = {
  render_table: (input) => {
    if (!Array.isArray(input.headers) || !Array.isArray(input.rows)) return null
    return { type: "table", headers: input.headers, rows: input.rows } satisfies TableBlock
  },

  render_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    if (input.type === "donut") {
      return { type: "donut-chart", title: input.title, data: input.data } satisfies DonutChartBlock
    }
    if (input.type === "bar") {
      return { type: "bar-chart", title: input.title, data: input.data } satisfies BarChartBlock
    }
    return null
  },

  [RENDER_FOLLOWUPS_TOOL_NAME]: (input) => {
    const chips = sanitizeFollowupChips(input.chips)
    if (chips === null) return null
    return { type: "followups", chips } satisfies FollowupsBlock
  },

  [REPORT_STATUS_TOOL_NAME]: (input) => {
    const text = typeof input.status === "string" ? input.status.trim() : ""
    if (!text) return null
    return { type: "status", text } satisfies StatusBlock
  },
}

// Fresh copy so adapters can't mutate the shared definition.
export function buildRenderToolMap(): Record<string, RenderBuilder> {
  return { ...BUILDERS }
}

function sanitizeFollowupChips(raw: unknown): FollowupChip[] | null {
  if (!Array.isArray(raw)) return null
  const chips: FollowupChip[] = []
  for (const c of raw) {
    if (
      c &&
      typeof c === "object" &&
      typeof (c as { label?: unknown }).label === "string" &&
      typeof (c as { prompt?: unknown }).prompt === "string"
    ) {
      const chip = c as { label: string; prompt: string }
      if (chip.label.trim() && chip.prompt.trim()) {
        chips.push({ label: chip.label, prompt: chip.prompt })
      }
    }
  }
  return chips.length > 0 ? chips : null
}
