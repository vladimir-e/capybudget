import { readFile, writeFile, rename } from "node:fs/promises"
import { join } from "node:path"
import type { FileAdapter } from "@capybudget/persistence"

export const nodeFileAdapter: FileAdapter = {
  readFile: (path: string) => readFile(path, "utf-8"),
  writeFile: (path: string, content: string) => writeFile(path, content, "utf-8"),
  rename,
  join: (...parts: string[]) => Promise.resolve(join(...parts)),
}
