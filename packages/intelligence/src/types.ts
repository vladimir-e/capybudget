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

export type ContentBlock =
  | TextBlock
  | TableBlock
  | BarChartBlock
  | DonutChartBlock
  | ToolActivityBlock
  | FileAttachmentBlock
  | FollowupsBlock

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
      /**
       * Optional turn-boundary signal. Only the Claude CLI adapter
       * sets this — its stream-json `assistant` events carry a per-turn
       * `message.id` that flips when the model starts a new turn
       * inside the same user→done cycle. Stateless decoders pass it
       * through; the session accumulates blocks across turns by
       * promoting them whenever the id changes.
       * API adapters keep an in-memory accumulator instead and never
       * emit this field.
       */
      messageId?: string
    }
  | { type: "done" }
  | { type: "error"; message: string }
