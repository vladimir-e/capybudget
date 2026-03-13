export interface CapyCommand {
  id: string
  name: string
  prompt: string
}

export const MOCK_COMMANDS: CapyCommand[] = [
  {
    id: "1",
    name: "Spending breakdown",
    prompt: "Break down my spending this month by category",
  },
  {
    id: "2",
    name: "Uncategorized",
    prompt: "Find uncategorized transactions and suggest categories",
  },
  {
    id: "3",
    name: "Subscriptions audit",
    prompt:
      "List all my recurring subscriptions and their monthly cost",
  },
  {
    id: "4",
    name: "Savings rate",
    prompt:
      "What percentage of my income am I saving this month compared to last month?",
  },
]
