/**
 * Render-tool → ContentBlock mapping.
 *
 * Shared by every adapter (Claude CLI, Anthropic API, OpenAI API). The
 * model emits the same `render_*` tool calls regardless of provider, so
 * each adapter routes them through the same builders here. Single source
 * of truth — adding a new render tool means adding it to
 * `RENDER_TOOL_DEFS` + here, nowhere else.
 *
 * Each builder validates the parsed tool input. If the payload is
 * malformed (model misbehavior), the builder returns `null` and the
 * adapter falls back to a `tool-activity` block — the chat keeps moving
 * rather than crashing the renderer.
 */
import type {
  BarChartBlock,
  ContentBlock,
  DonutChartBlock,
  FollowupChip,
  FollowupsBlock,
  TableBlock,
} from "./types"

type RenderBuilder = (input: Record<string, unknown>) => ContentBlock | null

const BUILDERS: Record<string, RenderBuilder> = {
  render_table: (input) => {
    if (!Array.isArray(input.headers) || !Array.isArray(input.rows)) return null
    return { type: "table", headers: input.headers, rows: input.rows } satisfies TableBlock
  },

  render_bar_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    return { type: "bar-chart", title: input.title, data: input.data } satisfies BarChartBlock
  },

  render_donut_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    return { type: "donut-chart", title: input.title, data: input.data } satisfies DonutChartBlock
  },

  render_followups: (input) => {
    const chips = sanitizeFollowupChips(input.chips)
    if (chips === null) return null
    return { type: "followups", chips } satisfies FollowupsBlock
  },
}

/**
 * Build a fresh copy of the render-tool map. Adapters take a fresh copy
 * (rather than the shared object) so any per-adapter extension stays
 * scoped — none currently do, but the contract is forward-friendly.
 */
export function buildRenderToolMap(): Record<string, RenderBuilder> {
  return { ...BUILDERS }
}

/**
 * Validate and normalize the `chips` payload from a `render_followups`
 * tool call. Returns the trimmed chip list, or `null` when the input is
 * malformed or empty (so the UI never renders an empty pill row).
 */
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
