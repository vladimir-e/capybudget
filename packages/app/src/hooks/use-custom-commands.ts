/**
 * Hook to read/write custom quick commands for the Capy AI assistant.
 * Stored as capy-commands.json in the budget folder.
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { join as joinPath } from "@tauri-apps/api/path"
import type { CapyCommand } from "@/components/capy/capy-commands"

const COMMANDS_FILE = "capy-commands.json"

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

interface UseCustomCommandsReturn {
  commands: CapyCommand[]
  isLoading: boolean
  save: (commands: CapyCommand[]) => Promise<void>
}

export function useCustomCommands(budgetPath: string): UseCustomCommandsReturn {
  const [commands, setCommands] = useState<CapyCommand[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const pathRef = useRef(budgetPath)
  pathRef.current = budgetPath

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const filePath = await joinPath(budgetPath, COMMANDS_FILE)
        const text = await readTextFile(filePath)
        const parsed = JSON.parse(text) as CapyCommand[]
        if (!cancelled) setCommands(sortCommands(parsed))
      } catch {
        // File doesn't exist — use defaults
        if (!cancelled) setCommands(sortCommands(DEFAULT_COMMANDS))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [budgetPath])

  const save = useCallback(async (next: CapyCommand[]) => {
    const sorted = sortCommands(next)
    const filePath = await joinPath(pathRef.current, COMMANDS_FILE)
    await writeTextFile(filePath, JSON.stringify(sorted, null, 2))
    setCommands(sorted)
  }, [])

  return { commands, isLoading, save }
}
