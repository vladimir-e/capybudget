import { useCallback } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";
import { useQueryClient } from "@tanstack/react-query";
import { useBudgetRepository } from "@/providers/repository-provider";
import { useUndoRedo } from "@/hooks/use-undo-redo";
import { budgetKeys } from "@/hooks/use-budget-data";
import { useImportPaths } from "@/hooks/use-import-paths";
import { createAccount } from "@capybudget/core";
import type { Account, Transaction, ImportTransaction } from "@capybudget/core";
import type { EntityMapping } from "@/components/import/import-mapping";

interface ImportAliases {
  accounts: Record<string, string>;
}

export interface MergeInput {
  transactions: ImportTransaction[];
  selectedIds: Set<string>;
  accountMapping: EntityMapping;
}

export interface MergeResult {
  transactionCount: number;
  accountsCreated: number;
}

export function useImportMerge(budgetPath: string) {
  const queryClient = useQueryClient();
  const repo = useBudgetRepository();
  const { captureSnapshot } = useUndoRedo();
  const { resolveImportPath, resolveAliasPath } = useImportPaths(budgetPath);

  const merge = useCallback(
    async (input: MergeInput): Promise<MergeResult> => {
      const { transactions, selectedIds, accountMapping } = input;
      const selected = transactions.filter((t) => selectedIds.has(t.id));
      if (selected.length === 0) throw new Error("No transactions selected");

      captureSnapshot();

      const prevAccounts =
        queryClient.getQueryData<Account[]>(budgetKeys.accounts()) ?? [];
      const prevTxns =
        queryClient.getQueryData<Transaction[]>(budgetKeys.transactions()) ?? [];

      // ── Create accounts for unmapped sources ──────────────────
      const sourcesToCreate = [
        ...new Set(selected.map((t) => t.sourceAccount).filter(Boolean)),
      ].filter(
        (s) => !accountMapping[s] || accountMapping[s] === "__create__",
      );

      let nextAccounts = [...prevAccounts];
      const createdIds: Record<string, string> = {};

      for (const source of sourcesToCreate) {
        const acct = createAccount(
          { name: source, type: "checking" },
          nextAccounts,
        );
        nextAccounts.push(acct);
        createdIds[source] = acct.id;
      }

      // ── Resolve account ID per transaction ────────────────────
      const resolveAccount = (t: ImportTransaction): string => {
        if (createdIds[t.sourceAccount]) return createdIds[t.sourceAccount];
        const mapped = accountMapping[t.sourceAccount];
        if (mapped && mapped !== "__create__") return mapped;
        return t.accountId || "";
      };

      // ── Convert to budget transactions ────────────────────────
      const createdAt = new Date().toISOString();

      const newTxns: Transaction[] = selected.map((t) => ({
        id: crypto.randomUUID(),
        datetime: `${t.date}T00:00:00.000`,
        type: t.type,
        amount: t.amount,
        categoryId: t.categoryId || "",
        accountId: resolveAccount(t),
        transferPairId: "",
        merchant: t.merchant || "",
        note: [t.description, t.memo].filter(Boolean).join(" — "),
        createdAt,
      }));

      const nextTxns = [...prevTxns, ...newTxns];

      // ── Persist budget data ───────────────────────────────────
      queryClient.setQueryData(budgetKeys.accounts(), nextAccounts);
      queryClient.setQueryData(budgetKeys.transactions(), nextTxns);
      await repo.saveAccounts(nextAccounts);
      await repo.saveTransactions(nextTxns);

      // ── Save aliases ──────────────────────────────────────────
      const aliases: ImportAliases = { accounts: {} };
      try {
        const content = await readTextFile(await resolveAliasPath());
        const parsed = JSON.parse(content);
        if (parsed.accounts) aliases.accounts = parsed.accounts;
      } catch {
        /* no existing aliases */
      }

      for (const [source, target] of Object.entries(accountMapping)) {
        if (target === "__create__" && createdIds[source]) {
          aliases.accounts[source] = createdIds[source];
        } else if (target && target !== "__create__") {
          aliases.accounts[source] = target;
        }
      }

      await writeTextFile(
        await resolveAliasPath(),
        JSON.stringify(aliases, null, 2),
      );

      // ── Import log ────────────────────────────────────────────
      const dates = selected.map((t) => t.date).sort();
      const logEntry = {
        date: createdAt,
        transactionCount: selected.length,
        accountsCreated: sourcesToCreate,
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
      await Promise.allSettled([
        resolveImportPath("transactions.csv").then((p) =>
          writeTextFile(p, ""),
        ),
        resolveImportPath("state.json").then((p) => writeTextFile(p, "")),
      ]);

      return {
        transactionCount: selected.length,
        accountsCreated: sourcesToCreate.length,
      };
    },
    [
      queryClient,
      repo,
      captureSnapshot,
      resolveImportPath,
      resolveAliasPath,
      budgetPath,
    ],
  );

  return { merge };
}
