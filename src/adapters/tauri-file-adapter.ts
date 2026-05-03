import {
  readTextFile,
  writeTextFile,
  rename,
  mkdir,
  readDir,
  remove,
  exists,
  stat,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { DirEntry, FileAdapter, FileStat } from "@capybudget/persistence";

export const tauriFileAdapter: FileAdapter = {
  readFile: readTextFile,
  writeFile: writeTextFile,
  rename,
  join: (...parts: string[]) => join(...parts),

  mkdir: (path: string, options?: { recursive?: boolean }) =>
    mkdir(path, { recursive: options?.recursive ?? false }),

  exists,

  readDir: async (path: string): Promise<DirEntry[]> => {
    const entries = await readDir(path);
    return entries.map((e) => ({
      name: e.name,
      isFile: e.isFile,
      isDirectory: e.isDirectory,
    }));
  },

  // Tauri plugin-fs has no appendFile; polyfill via read+write.
  // Treats a missing file as empty so behavior matches Node fs appendFile.
  appendFile: async (path: string, content: string) => {
    let existing = "";
    try {
      existing = await readTextFile(path);
    } catch {
      /* file does not exist yet — start fresh */
    }
    await writeTextFile(path, existing + content);
  },

  remove: (path: string, options?: { recursive?: boolean }) =>
    remove(path, { recursive: options?.recursive ?? false }),

  stat: async (path: string): Promise<FileStat> => {
    const info = await stat(path);
    return {
      size: info.size,
      isFile: info.isFile,
      isDirectory: info.isDirectory,
    };
  },
};
