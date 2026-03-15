/**
 * Hook to read/write custom instructions for the Capy AI assistant.
 * Stored as capy-instructions.md in the budget folder.
 */

import { useBudgetFile } from "./use-budget-file"

export function useCustomInstructions(budgetPath: string) {
  const { data: instructions, isLoading, save } = useBudgetFile(
    budgetPath,
    "capy-instructions.md",
    "",
    (text) => text,
    (text) => text,
  )

  return { instructions, isLoading, save }
}
