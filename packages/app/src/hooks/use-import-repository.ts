import { useCallback, useMemo } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { parseCsv, unparseCsv } from "@capybudget/persistence";
import { validateImportTransactions } from "@capybudget/core";
import type { ImportTransaction, ImportAliases } from "@capybudget/core";
import { useImportPaths } from "./use-import-paths";

const IMPORT_COERCE = { amount: (v: string) => parseInt(v, 10) };

export interface ImportState {
  sourceFiles: string[];
  enriched?: boolean;
}

/**
 * Centralizes all import disk I/O: CSV read/write, state.json, aliases.json.
 * Components should use this instead of scattered readTextFile/writeTextFile calls.
 */
export interface ImportLogEntry {
  date: string;
  sourceFiles: string[];
  transactionCount: number;
  accountsCreated: string[];
  dateRange: { from: string; to: string };
}

export function useImportRepository(budgetPath: string) {
  const { resolveImportPath, resolveAliasPath, resolveLogPath } = useImportPaths(budgetPath);

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
      const csvPath = await resolveImportPath("transactions.csv");
      const csv = unparseCsv(transactions);
      await writeTextFile(csvPath, csv);
    },
    [resolveImportPath],
  );

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
      const statePath = await resolveImportPath("state.json");
      await writeTextFile(statePath, JSON.stringify(state));
    },
    [resolveImportPath],
  );

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

  const clearImportData = useCallback(async () => {
    await Promise.allSettled([
      resolveImportPath("transactions.csv").then((p) => writeTextFile(p, "")),
      resolveImportPath("state.json").then((p) => writeTextFile(p, "")),
    ]);
  }, [resolveImportPath]);

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

  const hasImportData = useCallback(async (): Promise<boolean> => {
    try {
      const csvPath = await resolveImportPath("transactions.csv");
      const content = await readTextFile(csvPath);
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }, [resolveImportPath]);

  return useMemo(
    () => ({
      readTransactionsCsv,
      writeTransactionsCsv,
      readState,
      writeState,
      readAliases,
      writeAliases,
      clearImportData,
      appendImportLog,
      readImportLog,
      hasImportData,
    }),
    [
      readTransactionsCsv,
      writeTransactionsCsv,
      readState,
      writeState,
      readAliases,
      writeAliases,
      clearImportData,
      appendImportLog,
      readImportLog,
      hasImportData,
    ],
  );
}
