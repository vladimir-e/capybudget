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
  DuplicateGroupSummary,
  DuplicateGroupsBlock,
  FollowupChip,
  FollowupsBlock,
  RecurringPatternSummary,
  RecurringPatternsBlock,
  TableBlock,
  TransactionsBlock,
  TransactionsFilter,
} from "./types"

// Terminal-signal tool contract — see specs/INTELLIGENCE.md.
export const RENDER_FOLLOWUPS_TOOL_NAME = "render_followups"

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

  [RENDER_FOLLOWUPS_TOOL_NAME]: (input) => {
    const chips = sanitizeFollowupChips(input.chips)
    if (chips === null) return null
    return { type: "followups", chips } satisfies FollowupsBlock
  },

  render_transactions: (input) => {
    if (typeof input.label !== "string" || typeof input.count !== "number") return null
    const filter = sanitizeTransactionsFilter(input.filter)
    if (filter === null) return null
    const summary = typeof input.summary === "string" ? input.summary : undefined
    return {
      type: "transactions",
      label: input.label,
      count: input.count,
      filter,
      summary,
    } satisfies TransactionsBlock
  },

  render_duplicate_groups: (input) => {
    const groups = sanitizeDuplicateGroups(input.groups)
    if (groups === null) return null
    return { type: "duplicate-groups", groups } satisfies DuplicateGroupsBlock
  },

  render_recurring_patterns: (input) => {
    const patterns = sanitizeRecurringPatterns(input.patterns)
    if (patterns === null) return null
    return { type: "recurring-patterns", patterns } satisfies RecurringPatternsBlock
  },
}

// Fresh copy so adapters can't mutate the shared definition.
export function buildRenderToolMap(): Record<string, RenderBuilder> {
  return { ...BUILDERS }
}

function sanitizeTransactionsFilter(raw: unknown): TransactionsFilter | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const out: TransactionsFilter = {}

  if (Array.isArray(r.transactionIds)) {
    const ids = r.transactionIds.filter((v): v is string => typeof v === "string")
    if (ids.length > 0) out.transactionIds = ids
  }
  if (typeof r.categoryId === "string") out.categoryId = r.categoryId
  if (typeof r.merchant === "string") out.merchant = r.merchant
  if (r.dateRange && typeof r.dateRange === "object") {
    const dr = r.dateRange as Record<string, unknown>
    if (typeof dr.from === "string" && typeof dr.to === "string") {
      out.dateRange = { from: dr.from, to: dr.to }
    }
  }
  if (r.amountRange && typeof r.amountRange === "object") {
    const ar = r.amountRange as Record<string, unknown>
    if (typeof ar.min === "number" && typeof ar.max === "number") {
      out.amountRange = { min: ar.min, max: ar.max }
    }
  }
  if (r.type === "income" || r.type === "expense" || r.type === "transfer") {
    out.type = r.type
  }

  return out
}

function sanitizeDuplicateGroups(raw: unknown): DuplicateGroupSummary[] | null {
  if (!Array.isArray(raw)) return null
  const groups: DuplicateGroupSummary[] = []
  for (const g of raw) {
    if (!g || typeof g !== "object") continue
    const r = g as Record<string, unknown>
    if (!Array.isArray(r.transactionIds)) continue
    const ids = r.transactionIds.filter((v): v is string => typeof v === "string")
    if (ids.length < 2) continue
    if (r.confidence !== "high" && r.confidence !== "possible") continue
    if (typeof r.reason !== "string") continue
    if (typeof r.amount !== "number") continue
    if (typeof r.merchant !== "string") continue
    if (typeof r.date !== "string") continue
    groups.push({
      summary: typeof r.summary === "string" ? r.summary : undefined,
      transactionIds: ids,
      confidence: r.confidence,
      reason: r.reason,
      amount: r.amount,
      merchant: r.merchant,
      date: r.date,
    })
  }
  return groups.length > 0 ? groups : null
}

function sanitizeRecurringPatterns(raw: unknown): RecurringPatternSummary[] | null {
  if (!Array.isArray(raw)) return null
  const patterns: RecurringPatternSummary[] = []
  for (const p of raw) {
    if (!p || typeof p !== "object") continue
    const r = p as Record<string, unknown>
    if (typeof r.merchant !== "string") continue
    if (
      r.cadence !== "weekly" &&
      r.cadence !== "monthly" &&
      r.cadence !== "yearly" &&
      r.cadence !== "irregular"
    ) continue
    if (typeof r.averageAmount !== "number") continue
    if (r.amountVariance !== "stable" && r.amountVariance !== "variable") continue
    if (!Array.isArray(r.transactionIds)) continue
    const ids = r.transactionIds.filter((v): v is string => typeof v === "string")
    if (ids.length === 0) continue
    if (typeof r.firstSeen !== "string") continue
    if (typeof r.lastSeen !== "string") continue
    if (typeof r.totalSpent !== "number") continue
    patterns.push({
      merchant: r.merchant,
      cadence: r.cadence,
      averageAmount: r.averageAmount,
      amountVariance: r.amountVariance,
      transactionIds: ids,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      nextExpected: typeof r.nextExpected === "string" ? r.nextExpected : undefined,
      totalSpent: r.totalSpent,
    })
  }
  return patterns.length > 0 ? patterns : null
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
