import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import { useImportRepository } from "@/hooks/use-import-repository";
import type { ImportTransaction, ImportAliases } from "@capybudget/core";
import { buildDuplicateView } from "@/components/import/import-table-utils";
import type { EntityMapping } from "@/components/import/import-mapping";

/**
 * Owns the import preview data lifecycle:
 * - Loads CSV on mount (via repository, with validation)
 * - Validates categories, applies alias overlay
 * - Manages transaction state + debounced write-back
 * - Manages account mapping with batch accountId updates
 */
export function useImportData(budgetPath: string) {
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accountMapping, setAccountMapping] = useState<EntityMapping>({});
  const [loading, setLoading] = useState(true);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: existingTransactions = [] } = useTransactions();

  const repository = useImportRepository(budgetPath);

  // ── Write-back debounce ──────────────────────────────────────
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef(transactions);
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

  const writeBack = useCallback(async () => {
    try {
      await repository.writeTransactionsCsv(transactionsRef.current);
    } catch (err) {
      console.error("Failed to write import CSV:", err);
    }
  }, [repository]);

  const scheduleWriteBack = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(writeBack, 500);
  }, [writeBack]);

  // ── Flush pending write on unmount ───────────────────────────
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeBack();
      }
    };
  }, [writeBack]);

  // ── Load CSV on mount ────────────────────────────────────────
  //
  // The agent is the single source of truth for duplicates: a row marked
  // `duplicate` on staging starts unselected (dimmed), so the default merge
  // excludes it. A user can re-select it to force-import (it's already
  // dup-enriched). Non-duplicates start selected.
  const loadCsv = useCallback(async () => {
    try {
      const parsed = await repository.readTransactionsCsv();
      setTransactions(parsed);
      setSelectedIds(new Set(parsed.filter((t) => !t.duplicate).map((t) => t.id)));
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      await loadCsv();
      if (cancelled) return;
    }
    load();
    return () => { cancelled = true; };
  }, [loadCsv]);

  // ── Category validation + account-mapping overlay ────────────
  //
  // The run already resolved account mapping onto the staging CSV: the
  // accounts phase applied stored aliases (top precedence) then the agent
  // mapped the rest, both persisting `accountId`. The preview just renders
  // that — no name-match recompute. We read `accountId` off the rows to seed
  // the dropdowns, then overlay the alias file (which carries `__create__`
  // sentinels that never land as an `accountId`, and stays the authoritative
  // top layer). The manual-map path (`handleAccountMappingChange`) is the
  // user's final override and writes new aliases.
  const aliasesAppliedRef = useRef(false);
  useEffect(() => {
    if (aliasesAppliedRef.current || transactions.length === 0 || accounts.length === 0 || categories.length === 0) return;
    aliasesAppliedRef.current = true;

    async function applyMappings() {
      const accountIds = new Set(accounts.map((a) => a.id));
      const categoryIds = new Set(categories.map((c) => c.id));

      // 1. Seed the dropdowns from the persisted accountId on each row.
      const persistedMapping: EntityMapping = {};
      for (const txn of transactions) {
        if (txn.sourceAccount && !persistedMapping[txn.sourceAccount] && txn.accountId) {
          if (accountIds.has(txn.accountId)) {
            persistedMapping[txn.sourceAccount] = txn.accountId;
          }
        }
      }

      // 2. Validate categoryIds — clear invalid ones
      let needsCategoryFix = false;
      const validated = transactions.map((t) => {
        if (t.categoryId && !categoryIds.has(t.categoryId)) {
          needsCategoryFix = true;
          return { ...t, categoryId: "", categoryConfidence: "" };
        }
        return t;
      });
      if (needsCategoryFix) {
        setTransactions(validated);
        scheduleWriteBack();
      }

      // 3. Overlay the alias file — the authoritative top layer. It also
      // carries `__create__` sentinels, which the row's `accountId` can't
      // express (a to-be-created account has no UUID yet).
      const aliasMapping: EntityMapping = {};
      try {
        const aliases: ImportAliases = await repository.readAliases();
        const importAccounts = new Set(transactions.map((t) => t.sourceAccount).filter(Boolean));
        if (aliases.accounts && typeof aliases.accounts === "object") {
          for (const [source, targetId] of Object.entries(aliases.accounts)) {
            if (!importAccounts.has(source)) continue;
            if (targetId === "__create__" || accountIds.has(targetId)) {
              aliasMapping[source] = targetId;
            }
          }
        }
      } catch {
        // No aliases file
      }

      // Merge: aliases > persisted accountId (aliases-then-agent from the run)
      const merged = { ...persistedMapping, ...aliasMapping };
      if (Object.keys(merged).length > 0) {
        setAccountMapping(merged);
      }
    }

    applyMappings();
  }, [transactions, accounts, categories, repository, scheduleWriteBack]);

  // ── Transaction update handler ───────────────────────────────
  const handleUpdate = useCallback(
    (id: string, patch: Partial<ImportTransaction>) => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      scheduleWriteBack();
    },
    [scheduleWriteBack],
  );

  // ── Account mapping change → batch-update accountId ──────────
  //
  // The manual map is the user's final override AND the only alias-write
  // path: a source account the user maps here is recorded in
  // `.capy/aliases.json` so the next import pre-selects it (the accounts
  // phase's alias pre-step). The agent's run-time mapping persists only to
  // staging `accountId` — it never reaches the alias file. We diff against
  // the prior mapping and persist just the entries the user actually
  // changed to an existing account (`__create__` resolves to a UUID at
  // merge, so that alias is written there).
  const accountMappingRef = useRef(accountMapping);
  useEffect(() => { accountMappingRef.current = accountMapping; }, [accountMapping]);

  const handleAccountMappingChange = useCallback(
    (newMapping: EntityMapping) => {
      const prevMapping = accountMappingRef.current;
      setAccountMapping(newMapping);
      setTransactions((prev) =>
        prev.map((t) => {
          if (!t.sourceAccount) return t;
          const mappedId = newMapping[t.sourceAccount];
          const newAccountId = mappedId && mappedId !== "__create__" ? mappedId : "";
          if (t.accountId === newAccountId) return t;
          return { ...t, accountId: newAccountId };
        }),
      );
      scheduleWriteBack();

      const changed: Record<string, string> = {};
      for (const [source, target] of Object.entries(newMapping)) {
        if (target && target !== "__create__" && prevMapping[source] !== target) {
          changed[source] = target;
        }
      }
      if (Object.keys(changed).length > 0) {
        void (async () => {
          try {
            const aliases = await repository.readAliases();
            await repository.writeAliases({
              accounts: { ...aliases.accounts, ...changed },
            });
          } catch (err) {
            console.error("Failed to persist account aliases:", err);
          }
        })();
      }
    },
    [scheduleWriteBack, repository],
  );

  // ── Flush before external operations ─────────────────────────
  const flushWriteBack = useCallback(async () => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      await writeBack();
    }
  }, [writeBack]);

  // ── Derived data ─────────────────────────────────────────────
  const sourceAccounts = useMemo(
    () =>
      [
        ...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean)),
      ].sort(),
    [transactions],
  );

  const uncategorizedCount = useMemo(
    () => transactions.filter((t) => !t.categoryId && t.type !== "transfer").length,
    [transactions],
  );

  const lowConfidenceCount = useMemo(
    () => transactions.filter((t) => t.categoryConfidence === "low").length,
    [transactions],
  );

  // ── Duplicates (persisted, agent-authoritative) ─────────────────
  // Derived purely from the staging flags the dedup phase wrote — no live
  // recompute, so table/selection/merge all read the same source.
  const duplicates = useMemo(
    () => buildDuplicateView(transactions, existingTransactions),
    [transactions, existingTransactions],
  );

  return {
    // State
    transactions,
    selectedIds,
    setSelectedIds,
    accountMapping,
    loading,

    // Actions
    loadCsv,
    handleUpdate,
    handleAccountMappingChange,
    flushWriteBack,

    // Derived
    sourceAccounts,
    uncategorizedCount,
    lowConfidenceCount,
    duplicates,
    accounts,
    categories,
  };
}
