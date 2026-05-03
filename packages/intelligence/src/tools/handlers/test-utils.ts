/**
 * Lightweight in-memory FileAdapter for handler tests.
 *
 * Mirrors the behavioral contract of node fs / Tauri fs without the
 * setup overhead of mkdtemp + a real filesystem. Path joining uses
 * forward slashes so prefix checks in the handlers behave identically.
 */

import type {
  DirEntry,
  FileAdapter,
  FileStat,
} from "@capybudget/persistence"

export interface MemoryFs {
  files: Map<string, string>
  dirs: Set<string>
}

export function makeMemoryFs(): MemoryFs {
  return { files: new Map(), dirs: new Set() }
}

export function makeFileAdapter(fs: MemoryFs = makeMemoryFs()): FileAdapter {
  function ensureParent(path: string) {
    const parts = path.split("/").filter(Boolean)
    parts.pop()
    let cur = ""
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : `/${p}`
      fs.dirs.add(cur)
    }
  }

  return {
    async readFile(path: string): Promise<string> {
      const content = fs.files.get(path)
      if (content === undefined) throw new Error(`File not found: ${path}`)
      return content
    },
    async writeFile(path: string, content: string): Promise<void> {
      ensureParent(path)
      fs.files.set(path, content)
    },
    async rename(from: string, to: string): Promise<void> {
      const content = fs.files.get(from)
      if (content === undefined) throw new Error(`File not found: ${from}`)
      ensureParent(to)
      fs.files.set(to, content)
      fs.files.delete(from)
    },
    async join(...parts: string[]): Promise<string> {
      const cleaned = parts.flatMap((p) => p.split("/").filter(Boolean))
      const leadingSlash = parts[0]?.startsWith("/") ? "/" : ""
      return leadingSlash + cleaned.join("/")
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (options?.recursive) {
        ensureParent(path + "/.")
        fs.dirs.add(path)
      } else {
        fs.dirs.add(path)
      }
    },
    async exists(path: string): Promise<boolean> {
      return fs.files.has(path) || fs.dirs.has(path)
    },
    async readDir(path: string): Promise<DirEntry[]> {
      if (!fs.dirs.has(path)) throw new Error(`Directory not found: ${path}`)
      const entries: DirEntry[] = []
      const seenDirs = new Set<string>()
      const prefix = path + "/"
      for (const filePath of fs.files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length)
          const slash = rest.indexOf("/")
          if (slash === -1) {
            entries.push({ name: rest, isFile: true, isDirectory: false })
          } else {
            const name = rest.slice(0, slash)
            if (!seenDirs.has(name)) {
              seenDirs.add(name)
              entries.push({ name, isFile: false, isDirectory: true })
            }
          }
        }
      }
      for (const dir of fs.dirs) {
        if (dir.startsWith(prefix) && dir.slice(prefix.length).indexOf("/") === -1) {
          const name = dir.slice(prefix.length)
          if (name && !seenDirs.has(name) && !entries.some((e) => e.name === name)) {
            seenDirs.add(name)
            entries.push({ name, isFile: false, isDirectory: true })
          }
        }
      }
      return entries
    },
    async appendFile(path: string, content: string): Promise<void> {
      ensureParent(path)
      const existing = fs.files.get(path) ?? ""
      fs.files.set(path, existing + content)
    },
    async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (fs.files.has(path)) {
        fs.files.delete(path)
        return
      }
      if (fs.dirs.has(path)) {
        if (options?.recursive) {
          for (const f of [...fs.files.keys()]) {
            if (f === path || f.startsWith(path + "/")) fs.files.delete(f)
          }
          for (const d of [...fs.dirs]) {
            if (d === path || d.startsWith(path + "/")) fs.dirs.delete(d)
          }
        } else {
          fs.dirs.delete(path)
        }
      }
    },
    async stat(path: string): Promise<FileStat> {
      if (fs.files.has(path)) {
        return {
          size: fs.files.get(path)!.length,
          isFile: true,
          isDirectory: false,
        }
      }
      if (fs.dirs.has(path)) {
        return { size: 0, isFile: false, isDirectory: true }
      }
      throw new Error(`Not found: ${path}`)
    },
  }
}
