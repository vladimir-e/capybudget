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
export type MessageContent =
  | string
  | Array<CliTextContent | CliImageContent>

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

export type ContentBlock =
  | TextBlock
  | TableBlock
  | BarChartBlock
  | DonutChartBlock
  | ToolActivityBlock
  | FileAttachmentBlock

export interface ChatMessage {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
}

// ── Stream event types ──────────────────────────────────────────

export type StreamEvent =
  | { type: "content"; blocks: ContentBlock[] }
  | { type: "done" }
  | { type: "error"; message: string }

// ── Session event types ─────────────────────────────────────────

export type SessionEvent =
  | { type: "stdout"; line: string }
  | { type: "stderr"; line: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; message: string }
