/**
 * Generic hook for reading/writing a file in the budget folder.
 * Handles load-with-fallback and save-to-disk.
 *
 * Backed by a single TanStack Query entry keyed on (budgetPath, fileName), so
 * every surface that reads the same file shares one cache value. A `save` from
 * any surface writes the file and pushes the new value into the cache, so all
 * subscribers — including the lifted `/budget` layout that feeds the Capy
 * session — re-render with the fresh content immediately.
 *
 * `save` composes from the LATEST cached value, not a render-time snapshot, and
 * accepts an updater for read-modify-write. Two back-to-back edits (before a
 * re-render) each see the other's change, and disk writes are serialized so the
 * file can't lag behind the cache.
 */

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
