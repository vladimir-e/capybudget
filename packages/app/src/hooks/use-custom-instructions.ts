/**
 * Hooks to read/write custom instructions for the Capy AI assistant.
 * Chat and import have separate instruction files so they don't bleed into each other.
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

export function useImportInstructions(budgetPath: string) {
  const { data: instructions, isLoading, save } = useBudgetFile(
    budgetPath,
    "import-instructions.md",
    "",
    (text) => text,
    (text) => text,
  )

  return { instructions, isLoading, save }
}
