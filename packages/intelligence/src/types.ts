// ── File attachment ──────────────────────────────────────────────

export interface FileAttachment {
  name: string
  content: string
  size: number
  mediaType: string
}

// ── CLI message content (stream-json protocol) ──────────────────

export type CliTextContent = { type: "text"; text: string }
export type CliImageContent = {
  type: "image"
  source: { type: "base64"; media_type: string; data: string }
}
/** Document content — used for PDF imports under Anthropic / Claude CLI.
 *  OpenAI's chat.completions doesn't accept PDF input; the import flow
 *  surfaces a "switch provider" banner before we'd ever try. */
export type CliDocumentContent = {
  type: "document"
  source: { type: "base64"; media_type: string; data: string }
}
export type MessageContent =
  | string
  | Array<CliTextContent | CliImageContent | CliDocumentContent>

// ── Content block types (UI rendering) ──────────────────────────

export type MessageRole = "user" | "assistant"

export interface TextBlock {
  type: "text"
  content: string
}

export interface TableBlock {
  type: "table"
  headers: string[]
  rows: string[][]
}

export interface BarChartBlock {
  type: "bar-chart"
  title: string
  data: { label: string; value: number }[]
}

export interface DonutChartBlock {
  type: "donut-chart"
  title: string
  data: { label: string; value: number }[]
}

export interface ToolActivityBlock {
  type: "tool-activity"
  tool: string
}

export interface FileAttachmentBlock {
  type: "file-attachment"
  name: string
  size: number
  mediaType: string
}

export interface FollowupChip {
  label: string
  prompt: string
}

export interface FollowupsBlock {
  type: "followups"
  chips: FollowupChip[]
}

/** Filter payload for the transactions card. Mirrors `LockedFilters`
 *  in the app's transactions browser — kept in sync so the model's
 *  `render_transactions` filter applies cleanly when the modal opens.
 *  `transactionIds`, when present, takes precedence over the other
 *  fields (explicit selection wins). Dates as YYYY-MM-DD; amounts in
 *  cents, inclusive on both ends. */
export interface TransactionsFilter {
  transactionIds?: string[]
  categoryId?: string
  merchant?: string
  dateRange?: { from: string; to: string }
  amountRange?: { min: number; max: number }
  type?: "income" | "expense" | "transfer"
}

export interface TransactionsBlock {
  type: "transactions"
  label: string
  count: number
  filter: TransactionsFilter
  summary?: string
}

export interface DuplicateGroupSummary {
  summary?: string
  transactionIds: string[]
  confidence: "high" | "possible"
  reason: string
  /** Representative amount in cents. */
  amount: number
  merchant: string
  /** Representative date (YYYY-MM-DD). */
  date: string
}

export interface DuplicateGroupsBlock {
  type: "duplicate-groups"
  groups: DuplicateGroupSummary[]
}

export interface RecurringPatternSummary {
  merchant: string
  cadence: "weekly" | "monthly" | "yearly" | "irregular"
  /** Mean amount in cents; sign matches the underlying transactions. */
  averageAmount: number
  amountVariance: "stable" | "variable"
  transactionIds: string[]
  firstSeen: string
  lastSeen: string
  nextExpected?: string
  /** Sum of magnitudes in cents. */
  totalSpent: number
}

export interface RecurringPatternsBlock {
  type: "recurring-patterns"
  patterns: RecurringPatternSummary[]
}

/** Rendered when the underlying provider surfaces a fatal error.
 *  Carries enough metadata for the UI to render a billing CTA when
 *  the failure is a quota/credit issue. */
export interface ErrorBlock {
  type: "error"
  message: string
  status?: number
  provider?: SessionProvider
}

export type ContentBlock =
  | TextBlock
  | TableBlock
  | BarChartBlock
  | DonutChartBlock
  | ToolActivityBlock
  | FileAttachmentBlock
  | FollowupsBlock
  | TransactionsBlock
  | DuplicateGroupsBlock
  | RecurringPatternsBlock
  | ErrorBlock

export interface ChatMessage {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
}

// ── Stream event types ──────────────────────────────────────────

export type StreamEvent =
  | {
      type: "content"
      blocks: ContentBlock[]
      /** Per-turn boundary signal from Claude CLI's stream-json. */
      messageId?: string
    }
  | {
      /**
       * Signals that a tool call has *finished executing* and any side
       * effects (mutations) are now reflected in the underlying data.
       * Distinct from the `tool-activity` ContentBlock, which is emitted
       * when the model *requests* the call. The hook uses this to
       * invalidate caches live, per-call, rather than waiting for `done`.
       */
      type: "tool-result"
      tool: string
      /** Adapter-specific tool-call id; stable within a session so the
       *  consumer can debounce duplicates if the same result is forwarded
       *  more than once. */
      id: string
      /** True for clean runs, false when the handler threw. */
      ok: boolean
    }
  | { type: "done" }
  | {
      type: "error"
      message: string
      status?: number
      /** Set by the adapter so the UI can route billing CTAs to the
       *  right provider's console. Omitted on synthetic errors raised
       *  by the hook layer (e.g. budget exhausted, unconfigured). */
      provider?: SessionProvider
    }

export type SessionProvider = "anthropic" | "openai" | "claude-cli"
