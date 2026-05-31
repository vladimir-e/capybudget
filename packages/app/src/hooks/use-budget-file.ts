/**
 * Generic hook for reading/writing a file in the budget folder.
 * Handles load-with-fallback and save-to-disk.
 *
 * Backed by a single TanStack Query entry keyed on (budgetPath, fileName), so
 * every surface that reads the same file shares one cache value. A `save` from
 * any surface writes the file and pushes the new value into the cache, so all
 * subscribers — including the lifted `/budget` layout that feeds the Capy
 * session — re-render with the fresh content immediately.
 */

import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { join as joinPath } from "@tauri-apps/api/path"

interface UseBudgetFileReturn<T> {
  data: T
  isLoading: boolean
  save: (value: T) => Promise<void>
}

export function useBudgetFile<T>(
  budgetPath: string,
  fileName: string,
  defaultValue: T,
  parse: (text: string) => T,
  format: (value: T) => string,
): UseBudgetFileReturn<T> {
  const queryClient = useQueryClient()
  const queryKey = ["budget-file", budgetPath, fileName] as const

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const filePath = await joinPath(budgetPath, fileName)
        const text = await readTextFile(filePath)
        return text == null ? defaultValue : parse(text)
      } catch {
        // File doesn't exist yet (or fs is stubbed) — use defaults.
        return defaultValue
      }
    },
    staleTime: Infinity,
  })

  const save = useCallback(
    async (value: T) => {
      const filePath = await joinPath(budgetPath, fileName)
      await writeTextFile(filePath, format(value))
      queryClient.setQueryData(queryKey, value)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetPath, fileName, queryClient],
  )

  return { data: data ?? defaultValue, isLoading, save }
}
