import {
  readFile,
  writeFile,
  rename,
  mkdir,
  readdir,
  appendFile,
  rm,
  stat,
} from "node:fs/promises"
import { join } from "node:path"
import type { DirEntry, FileAdapter, FileStat } from "@capybudget/persistence"

export const nodeFileAdapter: FileAdapter = {
  readFile: (path: string) => readFile(path, "utf-8"),
  writeFile: (path: string, content: string) => writeFile(path, content, "utf-8"),
  rename,
  join: (...parts: string[]) => Promise.resolve(join(...parts)),

  mkdir: (path: string, options?: { recursive?: boolean }) =>
    mkdir(path, { recursive: options?.recursive ?? false }).then(() => undefined),

  exists: async (path: string) => {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  },

  readDir: async (path: string): Promise<DirEntry[]> => {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile(),
      isDirectory: e.isDirectory(),
    }))
  },

  appendFile: (path: string, content: string) => appendFile(path, content, "utf-8"),

  remove: async (path: string, options?: { recursive?: boolean }) => {
    await rm(path, { recursive: options?.recursive ?? false, force: true })
  },

  stat: async (path: string): Promise<FileStat> => {
    const info = await stat(path)
    return {
      size: info.size,
      isFile: info.isFile(),
      isDirectory: info.isDirectory(),
    }
  },
}
