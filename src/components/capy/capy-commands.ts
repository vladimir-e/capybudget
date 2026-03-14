export interface CapyCommand {
  id: string
  name: string
  prompt: string
}

export const DEFAULT_COMMANDS: CapyCommand[] = [
  {
    id: "spending-breakdown",
    name: "Spending breakdown",
    prompt: "Break down my spending this month by category",
  },
  {
    id: "uncategorized",
    name: "Uncategorized transactions",
    prompt: "Find uncategorized transactions and suggest categories",
  },
  {
    id: "account-balances",
    name: "Account balances",
    prompt: "Show all my account balances",
  },
  {
    id: "subscriptions",
    name: "Subscriptions audit",
    prompt:
      "List all my recurring subscriptions and their monthly cost",
  },
  {
    id: "savings-rate",
    name: "Savings rate",
    prompt:
      "What percentage of my income am I saving this month compared to last month?",
  },
]
