// Reads/writes a budget-folder file through a single TanStack Query entry keyed
// on (budgetPath, fileName), so every surface that reads the file shares — and
// re-renders from — one cache value.

import { useCallback, useRef } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { join as joinPath } from "@tauri-apps/api/path"

interface UseBudgetFileReturn<T> {
  data: T
  isLoading: boolean
  save: (value: T | ((prev: T) => T)) => Promise<void>
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

  // Tail of the write chain: each disk write awaits the previous so writes land
  // in issue order even if `writeTextFile` resolves out of order.
  const writeTail = useRef<Promise<void>>(Promise.resolve())

  const save = useCallback(
    (update: T | ((prev: T) => T)) => {
      const prev = queryClient.getQueryData<T>(queryKey) ?? data ?? defaultValue
      const next =
        typeof update === "function" ? (update as (prev: T) => T)(prev) : update
      // A functional updater that returns its input unchanged is a no-op — skip
      // the disk write so a "seed if missing" caller is free to call every render.
      if (next === prev) return Promise.resolve()
      // Update the cache before awaiting so a back-to-back save composes from
      // this value, not the stale render-time snapshot.
      queryClient.setQueryData(queryKey, next)
      const write = writeTail.current.then(async () => {
        const filePath = await joinPath(budgetPath, fileName)
        await writeTextFile(filePath, format(next))
      })
      // Keep the chain alive after a failure so one bad write doesn't wedge the
      // rest; surface the error to this caller.
      writeTail.current = write.catch(() => {})
      return write
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budgetPath, fileName, queryClient, data],
  )

  return { data: data ?? defaultValue, isLoading, save }
}
