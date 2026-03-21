import { useCallback } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/providers/repository-provider";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useImportRepository } from "@/hooks/use-import-repository";
import { prepareMerge } from "@capybudget/core";
import type { Account, Transaction } from "@capybudget/core";
import type { MergeInput } from "@capybudget/core";

export type { MergeInput };

export interface MergeResult {
  transactionCount: number;
  accountsCreated: number;
}

// useBudgetMutation is intentionally bypassed here: the merge operation
// needs extra I/O (alias persistence, import log, cleanup) interleaved
// with the budget write, which doesn't fit the simple get/set/save pattern.
export function useImportMerge(budgetPath: string) {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  const importRepo = useImportRepository(budgetPath);

  const merge = useCallback(
    async (input: MergeInput): Promise<MergeResult> => {
      captureSnapshot();

      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const prevTxns =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];

      // Read source file names saved at import start
      const state = await importRepo.readState();
      const sourceFileNames = state.sourceFiles ?? [];

      // Load existing aliases
      const existingAliases = await importRepo.readAliases();

      // Pure transformation
      const result = prepareMerge(input, prevAccounts, prevTxns, existingAliases);

      // ── Persist budget data ───────────────────────────────────
      queryClient.setQueryData(budgetKeys.accounts(), result.accounts);
      queryClient.setQueryData(budgetKeys.transactions(), result.transactions);
      await repo.saveAccounts(result.accounts);
      await repo.saveTransactions(result.transactions);

      // ── Save aliases ──────────────────────────────────────────
      await importRepo.writeAliases(result.aliases);

      // ── Import log ────────────────────────────────────────────
      const selected = input.transactions.filter((t) => input.selectedIds.has(t.id));
      const dates = selected.map((t) => t.date).sort();
      const logEntry = {
        date: new Date().toISOString(),
        sourceFiles: sourceFileNames,
        transactionCount: selected.length,
        accountsCreated: result.sourcesToCreate,
        dateRange: { from: dates[0], to: dates[dates.length - 1] },
      };

      try {
        const capyDir = await joinPath(budgetPath, ".capy");
        const logPath = await joinPath(capyDir, "import-log.json");
        let log: unknown[] = [];
        try {
          log = JSON.parse(await readTextFile(logPath));
          if (!Array.isArray(log)) log = [];
        } catch {
          /* new log */
        }
        log.push(logEntry);
        await writeTextFile(logPath, JSON.stringify(log, null, 2));
      } catch {
        /* best-effort */
      }

      // ── Clear import working directory ────────────────────────
      await importRepo.clearImportData();

      return {
        transactionCount: selected.length,
        accountsCreated: result.sourcesToCreate.length,
      };
    },
    [
      queryClient,
      repo,
      captureSnapshot,
      importRepo,
      budgetPath,
    ],
  );

  return { merge };
}
