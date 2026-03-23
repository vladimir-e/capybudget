import { useCallback, useMemo } from "react";
import {
  readTextFile,
  writeTextFile,
  writeFile,
  readDir,
  remove,
  mkdir,
  exists,
  size,
} from "@tauri-apps/plugin-fs";
import { parseCsv, unparseCsv } from "@capybudget/persistence";
import { validateImportTransactions } from "@capybudget/core";
import type { ImportTransaction, ImportAliases, ImportLogEntry } from "@capybudget/core";
import { useImportPaths } from "./use-import-paths";

const IMPORT_COERCE = { amount: (v: string) => parseInt(v, 10) };

export interface ImportState {
  sourceFiles: string[];
  enriched?: boolean;
}

/** Info about a source file on disk. */
export interface SourceFileInfo {
  name: string;
  size: number;
}

/**
 * Centralizes all import disk I/O: source files, CSV read/write, state.json, aliases.json.
 *
 * Directory layout:
 *   .capy/import/
 *     sources/        ← user-dropped source files (CSV, images, PDFs)
 *     transactions.csv ← normalized output
 *     state.json       ← metadata
 */

export function useImportRepository(budgetPath: string) {
  const {
    resolveImportPath,
    resolveSourcePath,
    resolveSourcesDir,
    resolveImportDir,
    resolveAliasPath,
    resolveLogPath,
  } = useImportPaths(budgetPath);

  // ── Directory helpers ────────────────────────────────────────

  /** Ensure .capy/import/sources/ exists. */
  const ensureSourcesDir = useCallback(async () => {
    const dir = await resolveSourcesDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }, [resolveSourcesDir]);

  /** Ensure .capy/import/ exists. */
  const ensureImportDir = useCallback(async () => {
    const dir = await resolveImportDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }, [resolveImportDir]);

  // ── Source file management ───────────────────────────────────

  /** Write a source file to .capy/import/sources/. For text files, pass string content. For binary (images), pass Uint8Array. */
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

  /** List source files in .capy/import/sources/. Returns [] if directory doesn't exist. */
  const listSourceFiles = useCallback(async (): Promise<SourceFileInfo[]> => {
    try {
      const dir = await resolveSourcesDir();
      if (!(await exists(dir))) return [];
      const entries = await readDir(dir);
      const files: SourceFileInfo[] = [];
      for (const entry of entries) {
        if (!entry.isFile) continue;
        try {
          const fileSize = await size(`${dir}/${entry.name}`);
          files.push({ name: entry.name, size: fileSize });
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
        const path = await resolveSourcePath(filename);
        await remove(path);
      } catch {
        /* file may already be gone */
      }
    },
    [resolveSourcePath],
  );

  // ── Transactions CSV ────────────────────────────────────────

  const readTransactionsCsv = useCallback(async (): Promise<ImportTransaction[]> => {
    const csvPath = await resolveImportPath("transactions.csv");
    const content = await readTextFile(csvPath);
    const parsed = parseCsv<ImportTransaction>(content, IMPORT_COERCE).map(
      (t) => ({
        ...t,
        merchant: t.merchant || "",
        accountId: t.accountId || "",
        categoryId: t.categoryId || "",
        categoryConfidence: t.categoryConfidence || "",
      }),
    );
    const { valid, warnings } = validateImportTransactions(parsed);
    if (warnings.length > 0) {
      console.warn("[import-repository] CSV validation warnings:", warnings);
    }
    return valid;
  }, [resolveImportPath]);

  const writeTransactionsCsv = useCallback(
    async (transactions: ImportTransaction[]) => {
      await ensureImportDir();
      const csvPath = await resolveImportPath("transactions.csv");
      const csv = unparseCsv(transactions);
      await writeTextFile(csvPath, csv);
    },
    [ensureImportDir, resolveImportPath],
  );

  // ── State ───────────────────────────────────────────────────

  const readState = useCallback(async (): Promise<ImportState> => {
    try {
      const statePath = await resolveImportPath("state.json");
      const content = await readTextFile(statePath);
      if (!content.trim()) return { sourceFiles: [] };
      return JSON.parse(content) as ImportState;
    } catch {
      return { sourceFiles: [] };
    }
  }, [resolveImportPath]);

  const writeState = useCallback(
    async (state: ImportState) => {
      await ensureImportDir();
      const statePath = await resolveImportPath("state.json");
      await writeTextFile(statePath, JSON.stringify(state));
    },
    [ensureImportDir, resolveImportPath],
  );

  // ── Aliases ─────────────────────────────────────────────────

  const readAliases = useCallback(async (): Promise<ImportAliases> => {
    try {
      const aliasPath = await resolveAliasPath();
      const content = await readTextFile(aliasPath);
      const parsed = JSON.parse(content);
      if (parsed.accounts) return parsed as ImportAliases;
      return { accounts: {} };
    } catch {
      return { accounts: {} };
    }
  }, [resolveAliasPath]);

  const writeAliases = useCallback(
    async (aliases: ImportAliases) => {
      const aliasPath = await resolveAliasPath();
      await writeTextFile(aliasPath, JSON.stringify(aliases, null, 2));
    },
    [resolveAliasPath],
  );

  // ── Cleanup ─────────────────────────────────────────────────

  /** Wipe the entire .capy/import/ directory (sources, transactions.csv, state.json). */
  const clearImportData = useCallback(async () => {
    try {
      const dir = await resolveImportDir();
      if (await exists(dir)) {
        await remove(dir, { recursive: true });
      }
    } catch {
      /* best-effort — directory may not exist */
    }
  }, [resolveImportDir]);

  // ── Import log ──────────────────────────────────────────────

  const appendImportLog = useCallback(async (entry: ImportLogEntry) => {
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
  }, [resolveLogPath]);

  const readImportLog = useCallback(async (): Promise<ImportLogEntry[]> => {
    try {
      const logPath = await resolveLogPath();
      const content = await readTextFile(logPath);
      const log = JSON.parse(content);
      if (!Array.isArray(log)) return [];
      return log as ImportLogEntry[];
    } catch {
      return [];
    }
  }, [resolveLogPath]);

  // ── Status checks ───────────────────────────────────────────

  /** True when transactions.csv exists with content (→ show preview). */
  const hasTransactionsCsv = useCallback(async (): Promise<boolean> => {
    try {
      const csvPath = await resolveImportPath("transactions.csv");
      const content = await readTextFile(csvPath);
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }, [resolveImportPath]);

  /** True when there are source files in sources/ (→ show file list). */
  const hasSourceFiles = useCallback(async (): Promise<boolean> => {
    try {
      const dir = await resolveSourcesDir();
      if (!(await exists(dir))) return false;
      const entries = await readDir(dir);
      return entries.some((e) => e.isFile);
    } catch {
      return false;
    }
  }, [resolveSourcesDir]);

  return useMemo(
    () => ({
      // Source files
      writeSourceFile,
      listSourceFiles,
      removeSourceFile,
      // Transactions
      readTransactionsCsv,
      writeTransactionsCsv,
      // State
      readState,
      writeState,
      // Aliases
      readAliases,
      writeAliases,
      // Cleanup
      clearImportData,
      // Log
      appendImportLog,
      readImportLog,
      // Status
      hasTransactionsCsv,
      hasSourceFiles,
    }),
    [
      writeSourceFile,
      listSourceFiles,
      removeSourceFile,
      readTransactionsCsv,
      writeTransactionsCsv,
      readState,
      writeState,
      readAliases,
      writeAliases,
      clearImportData,
      appendImportLog,
      readImportLog,
      hasTransactionsCsv,
      hasSourceFiles,
    ],
  );
}
