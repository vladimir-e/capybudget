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
    id: "spending-breakdown",
    name: "Spending breakdown",
    prompt: "Break down my spending this month by category",
  },
  {
    id: "subscriptions",
    name: "Subscriptions audit",
    prompt: "List all my recurring subscriptions and their monthly cost",
  },
  {
    id: "savings-rate",
    name: "Savings rate",
    prompt: "What percentage of my income am I saving this month compared to last month?",
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
