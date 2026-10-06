// ── File attachment ──────────────────────────────────────────────

export interface FileAttachment {
  name: string
  content: string
  size: number
  mediaType: string
}

// ── User message content ─────────────────────────────────────────

export type UserTextContent = { type: "text"; text: string }
export type UserImageContent = {
  type: "image"
  source: { type: "base64"; media_type: string; data: string }
}
/** Document content — used for PDF imports and chat PDF attachments.
 *  Anthropic sends it through the SDK's native `document` type; OpenAI
 *  takes it as an `input_file` content part, which carries the source
 *  filename. Ollama has no document part. */
export type UserDocumentContent = {
  type: "document"
  source: { type: "base64"; media_type: string; data: string }
  filename?: string
}
export type MessageContent =
  | string
  | Array<UserTextContent | UserImageContent | UserDocumentContent>

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

export interface ChartPoint {
  label: string
  value: number
}

export interface BarChartBlock {
  type: "bar-chart"
  title: string
  data: ChartPoint[]
}

export interface DonutChartBlock {
  type: "donut-chart"
  title: string
  data: ChartPoint[]
}

export type ToolCallStatus = "pending" | "running" | "done" | "failed"

export interface ToolActivityBlock {
  type: "tool-activity"
  tool: string
  status: ToolCallStatus
  id?: string
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
  | ErrorBlock

export interface ChatMessage {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
  unsent?: boolean
}

// ── Stream event types ──────────────────────────────────────────

export type StreamEvent =
  | { type: "content"; blocks: ContentBlock[] }
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
       *  right provider's console and name it in copy. Omitted on
       *  synthetic errors raised by the hook layer (e.g. unconfigured). */
      provider?: SessionProvider
      /** Set on errors the UI words itself (`session.<code>` in the capy
       *  namespace); `message` is then a terse diagnostic. */
      code?: SessionErrorCode
      /** The failed send was taken back out of the model's history, so the
       *  chat must not show it as delivered. */
      rolledBack?: boolean
    }

export type SessionErrorCode = "cutOff" | "refused" | "budgetExhausted" | "rateLimited" | "unreachable"

export type SessionProvider = "anthropic" | "openai" | "claude-cli" | "ollama"
