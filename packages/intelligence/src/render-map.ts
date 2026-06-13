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
 * malformed or would render visually empty (model misbehavior), the
 * builder returns `null`: the adapter falls back to a `tool-activity`
 * block so the call stays visible, and dispatch (via
 * `validateRenderInput`) returns an error tool result so the model can
 * self-correct instead of believing the render succeeded.
 */
import type {
  BarChartBlock,
  ContentBlock,
  DonutChartBlock,
  FollowupChip,
  FollowupsBlock,
  TableBlock,
} from "./types"

// Terminal-signal tool contract — see specs/INTELLIGENCE.md.
export const RENDER_FOLLOWUPS_TOOL_NAME = "render_followups"

type RenderBuilder = (input: Record<string, unknown>) => ContentBlock | null

const BUILDERS = {
  render_table: (input) => {
    if (!Array.isArray(input.headers) || !Array.isArray(input.rows)) return null
    if (input.headers.length === 0 || input.rows.length === 0) return null
    return { type: "table", headers: input.headers, rows: input.rows } satisfies TableBlock
  },

  render_chart: (input) => {
    if (typeof input.title !== "string" || !Array.isArray(input.data)) return null
    if (input.data.length === 0) return null
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
} satisfies Record<string, RenderBuilder>

type RenderToolName = keyof typeof BUILDERS

// Fresh copy so adapters can't mutate the shared definition.
export function buildRenderToolMap(): Record<string, RenderBuilder> {
  return { ...BUILDERS }
}

// Keyed against the builder map: adding a builder without its expected-shape
// message is a compile error, so the validation message can't degrade to
// "expects undefined".
const EXPECTED_INPUTS: Record<RenderToolName, string> = {
  render_table: "{headers: [...], rows: [[...], ...]} with at least one header and one row",
  render_chart: '{title, type: "bar" | "donut", data: [{label, value}, ...]} with non-empty data',
  [RENDER_FOLLOWUPS_TOOL_NAME]: "{chips: [{label, prompt}, ...]} with at least one chip",
}

/**
 * Validate a render tool's input through the same builder the adapters
 * render with, so dispatch can't disagree with the UI about what's
 * renderable. Returns an error message for the model, or `null` when
 * the input is fine (or the tool has no builder here).
 */
export function validateRenderInput(
  name: string,
  input: Record<string, unknown>,
): string | null {
  if (!isRenderToolName(name) || BUILDERS[name](input) !== null) return null
  return `Invalid input: ${name} expects ${EXPECTED_INPUTS[name]}. Nothing was rendered.`
}

function isRenderToolName(name: string): name is RenderToolName {
  return name in BUILDERS
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
