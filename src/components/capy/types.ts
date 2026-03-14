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

export type ContentBlock =
  | TextBlock
  | TableBlock
  | BarChartBlock
  | DonutChartBlock

export interface ChatMessage {
  id: string
  role: MessageRole
  blocks: ContentBlock[]
}
