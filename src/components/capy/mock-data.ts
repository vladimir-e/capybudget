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

export const MOCK_CONVERSATION: ChatMessage[] = [
  {
    id: "1",
    role: "user",
    blocks: [
      { type: "text", content: "How am I spending my money this month?" },
    ],
  },
  {
    id: "2",
    role: "assistant",
    blocks: [
      {
        type: "text",
        content:
          "Here's your March spending breakdown. You've spent $459.47 across 5 categories. Clothing is your biggest expense this month at $315.00 — that's nearly 69% of total spend.",
      },
      {
        type: "donut-chart",
        title: "Spending Distribution",
        data: [
          { label: "Clothing", value: 315 },
          { label: "Subscriptions", value: 92 },
          { label: "Dining Out", value: 29 },
          { label: "Housekeeping", value: 12 },
          { label: "Groceries", value: 11.47 },
        ],
      },
      {
        type: "bar-chart",
        title: "Top Expenses — March 2026",
        data: [
          { label: "Clothing", value: 315 },
          { label: "Subscriptions", value: 92 },
          { label: "Dining Out", value: 29 },
          { label: "Housekeeping", value: 12 },
          { label: "Groceries", value: 11.47 },
        ],
      },
    ],
  },
  {
    id: "3",
    role: "user",
    blocks: [
      {
        type: "text",
        content:
          "I have some uncategorized transactions. Can you categorize them?",
      },
    ],
  },
  {
    id: "4",
    role: "assistant",
    blocks: [
      {
        type: "text",
        content:
          "I found 1 uncategorized transaction. Based on the amount and date pattern, here's what I can suggest:",
      },
      {
        type: "table",
        headers: [
          "Date",
          "Account",
          "Amount",
          "Suggested Category",
          "Confidence",
        ],
        rows: [["Mar 12", "Wallet", "-$120.00", "Miscellaneous", "Low"]],
      },
      {
        type: "text",
        content:
          "This transaction has no merchant name, which makes it hard to auto-categorize with confidence. If you add a merchant, I can match it against your spending patterns and do much better. Want me to apply the suggestion anyway?",
      },
    ],
  },
]
