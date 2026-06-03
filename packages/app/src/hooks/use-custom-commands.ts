/**
 * Hook to read/write custom quick commands for the Capy AI assistant.
 * Stored as capy-commands.json in the budget folder.
 */

import { useCallback } from "react"
import { useBudgetFile } from "./use-budget-file"

export interface CapyCommand {
  id: string
  name: string
  prompt: string
}

const DEFAULT_COMMANDS: CapyCommand[] = [
  {
    id: "categorize-transactions",
    name: "Categorize transactions",
    prompt:
      "Find my most recent uncategorized transactions and assign each one a category based on the merchant, amount, and any notes. Show me the proposed categories before applying them.",
  },
  {
    id: "review-subscriptions",
    name: "Review subscriptions",
    prompt:
      "Surface my active recurring payments — subscriptions, memberships, and other periodic charges. List each with its cadence and monthly cost.",
  },
  {
    id: "account-data-cutoff",
    name: "Account data cutoff",
    prompt:
      "For each active account, show the date of the most recent transaction so I can see how current each account's data is before importing more from my bank.",
  },
]

function sortCommands(commands: CapyCommand[]): CapyCommand[] {
  return [...commands].sort((a, b) => a.name.localeCompare(b.name))
}

export function useCustomCommands(budgetPath: string) {
  const { data, isLoading, save } = useBudgetFile(
    budgetPath,
    "capy-commands.json",
    sortCommands(DEFAULT_COMMANDS),
    (text) => sortCommands(JSON.parse(text) as CapyCommand[]),
    (v) => JSON.stringify(v, null, 2),
  )

  const saveCommands = useCallback(
    (commands: CapyCommand[]) => save(sortCommands(commands)),
    [save],
  )

  return { commands: data, isLoading, save: saveCommands }
}
