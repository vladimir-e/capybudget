import { readTextFile, writeTextFile, rename } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { FileAdapter } from "@capybudget/persistence";

export const tauriFileAdapter: FileAdapter = {
  readFile: readTextFile,
  writeFile: writeTextFile,
  rename,
  join: (...parts: string[]) => join(...parts),
};
