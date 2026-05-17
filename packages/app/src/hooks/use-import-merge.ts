import { useCallback, useState } from "react";
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

/**
 * Phases the merge passes through. `prepareMerge` is synchronous and
 * CPU-bound, so `'preparing'` mostly exists to render a state before the
 * freeze starts; `'saving'` and `'finalizing'` cover the async tail.
 */
export type MergePhase = "preparing" | "saving" | "finalizing" | null;

// useBudgetMutation is intentionally bypassed here: the merge operation
// needs extra I/O (alias persistence, import log, cleanup) interleaved
// with the budget write, which doesn't fit the simple get/set/save pattern.
export function useImportMerge(budgetPath: string) {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  const importRepo = useImportRepository(budgetPath);
  const [mergePhase, setMergePhase] = useState<MergePhase>(null);

  const merge = useCallback(
    async (input: MergeInput): Promise<MergeResult> => {
      try {
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

        // ── Preparing (pure CPU; will freeze the main thread) ─────
        setMergePhase("preparing");
        // Yield once so React commits the dialog state before the
        // synchronous freeze starts. Cheap insurance against a silent UI.
        await new Promise((r) => setTimeout(r, 0));
        const result = prepareMerge(input, prevAccounts, prevTxns, existingAliases);

        // ── Persist budget data ───────────────────────────────────
        setMergePhase("saving");
        queryClient.setQueryData(budgetKeys.accounts(), result.accounts);
        queryClient.setQueryData(budgetKeys.transactions(), result.transactions);
        await repo.saveAccounts(result.accounts);
        await repo.saveTransactions(result.transactions);

        // ── Finalize: aliases, log, cleanup ───────────────────────
        setMergePhase("finalizing");
        await importRepo.writeAliases(result.aliases);

        const selected = input.transactions.filter((t) => input.selectedIds.has(t.id));
        const dates = selected.map((t) => t.date).sort();
        await importRepo.appendImportLog({
          date: new Date().toISOString(),
          sourceFiles: sourceFileNames,
          transactionCount: selected.length,
          accountsCreated: result.sourcesToCreate,
          dateRange: { from: dates[0], to: dates[dates.length - 1] },
        });

        await importRepo.clearImportData();

        return {
          transactionCount: selected.length,
          accountsCreated: result.sourcesToCreate.length,
        };
      } finally {
        setMergePhase(null);
      }
    },
    [
      queryClient,
      repo,
      captureSnapshot,
      importRepo,
    ],
  );

  return { merge, mergePhase };
}
