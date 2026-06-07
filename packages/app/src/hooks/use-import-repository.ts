import { useCallback, useMemo } from "react";
import {
  readTextFile,
  writeTextFile,
  writeFile,
  readDir,
  remove,
  mkdir,
  exists,
  stat,
} from "@tauri-apps/plugin-fs";
import type { ImportAliases, ImportLogEntry } from "@capybudget/core";
import { useImportPaths } from "./use-import-paths";

/** Info about a source file on disk. */
export interface SourceFileInfo {
  name: string;
  size: number;
}

/**
 * Import disk I/O the app owns: source files, the cross-import aliases, the
 * import log, and directory cleanup.
 *
 * The staging artifacts the orchestrator owns (`transactions.csv`, `context.json`,
 * `state.json`) are read and written through `@capybudget/intelligence`'s
 * `FileStagingStore` — one serialization path keeps the persisted `duplicate`
 * flag and the run phase consistent across the engine and the preview.
 *
 *   .capy/import/
 *     sources/         ← user-dropped source files (CSV, images, PDFs) — this hook
 *     transactions.csv ← normalized staging — FileStagingStore
 *     context.json     ← per-row history signals — FileStagingStore
 *     state.json       ← run phase + metadata — FileStagingStore
 *   .capy/aliases.json     ← sourceAccount → accountId mappings — this hook
 *   .capy/import-log.json  ← past imports — this hook
 */
export function useImportRepository(budgetPath: string) {
  const { resolveSourcePath, resolveSourcesDir, resolveImportDir, resolveAliasPath, resolveLogPath } =
    useImportPaths(budgetPath);

  const ensureSourcesDir = useCallback(async () => {
    const dir = await resolveSourcesDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }, [resolveSourcesDir]);

  // ── Source file management ───────────────────────────────────

  /** Write a source file to sources/. Text content as string, binary (images) as bytes. */
  const writeSourceFile = useCallback(
    async (filename: string, content: string | Uint8Array) => {
      await ensureSourcesDir();
      const path = await resolveSourcePath(filename);
      if (typeof content === "string") {
        await writeTextFile(path, content);
      } else {
        await writeFile(path, content);
      }
    },
    [ensureSourcesDir, resolveSourcePath],
  );

  /** List source files in sources/. Returns [] if the directory doesn't exist. */
  const listSourceFiles = useCallback(async (): Promise<SourceFileInfo[]> => {
    try {
      const dir = await resolveSourcesDir();
      if (!(await exists(dir))) return [];
      const entries = await readDir(dir);
      const files: SourceFileInfo[] = [];
      for (const entry of entries) {
        if (!entry.isFile) continue;
        try {
          const info = await stat(`${dir}/${entry.name}`);
          files.push({ name: entry.name, size: info.size });
        } catch {
          files.push({ name: entry.name, size: 0 });
        }
      }
      return files;
    } catch {
      return [];
    }
  }, [resolveSourcesDir]);

  /** Remove a single source file. */
  const removeSourceFile = useCallback(
    async (filename: string) => {
      try {
        await remove(await resolveSourcePath(filename));
      } catch {
        /* file may already be gone */
      }
    },
    [resolveSourcePath],
  );

  // ── Aliases ─────────────────────────────────────────────────

  const readAliases = useCallback(async (): Promise<ImportAliases> => {
    try {
      const content = await readTextFile(await resolveAliasPath());
      const parsed = JSON.parse(content);
      if (parsed.accounts) return parsed as ImportAliases;
      return { accounts: {} };
    } catch {
      return { accounts: {} };
    }
  }, [resolveAliasPath]);

  const writeAliases = useCallback(
    async (aliases: ImportAliases) => {
      await writeTextFile(await resolveAliasPath(), JSON.stringify(aliases, null, 2));
    },
    [resolveAliasPath],
  );

  // ── Cleanup ─────────────────────────────────────────────────

  /** Wipe the entire .capy/import/ directory (sources + all staging artifacts). */
  const clearImportData = useCallback(async () => {
    try {
      const dir = await resolveImportDir();
      if (await exists(dir)) await remove(dir, { recursive: true });
    } catch {
      /* best-effort — directory may not exist */
    }
  }, [resolveImportDir]);

  // ── Import log ──────────────────────────────────────────────

  const appendImportLog = useCallback(
    async (entry: ImportLogEntry) => {
      try {
        const logPath = await resolveLogPath();
        let log: unknown[] = [];
        try {
          log = JSON.parse(await readTextFile(logPath));
          if (!Array.isArray(log)) log = [];
        } catch {
          /* new log */
        }
        log.push(entry);
        await writeTextFile(logPath, JSON.stringify(log, null, 2));
      } catch {
        /* best-effort */
      }
    },
    [resolveLogPath],
  );

  const readImportLog = useCallback(async (): Promise<ImportLogEntry[]> => {
    try {
      const log = JSON.parse(await readTextFile(await resolveLogPath()));
      return Array.isArray(log) ? (log as ImportLogEntry[]) : [];
    } catch {
      return [];
    }
  }, [resolveLogPath]);

  return useMemo(
    () => ({
      writeSourceFile,
      listSourceFiles,
      removeSourceFile,
      readAliases,
      writeAliases,
      clearImportData,
      appendImportLog,
      readImportLog,
    }),
    [
      writeSourceFile,
      listSourceFiles,
      removeSourceFile,
      readAliases,
      writeAliases,
      clearImportData,
      appendImportLog,
      readImportLog,
    ],
  );
}
