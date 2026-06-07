import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { useImportRepository } from "@/hooks/use-import-repository";
import { matchAccountsByName } from "@capybudget/core";
import { needsEnrich, type StagingStore } from "@capybudget/intelligence";
import type { ImportTransaction, ImportAliases } from "@capybudget/core";
import type { EntityMapping } from "@/components/import/import-mapping";

/**
 * Owns the import preview's data lifecycle against disk staging.
 *
 * Staging (`.capy/import/transactions.csv`) is the source of truth — the same
 * file the orchestrator writes per batch. This hook reads it through the shared
 * {@link StagingStore} (so the persisted `duplicate` flag round-trips), reloads
 * it whenever `rowsVersion` ticks (live fill during a run), validates category
 * ids against the budget, resolves the account mapping, and debounces hand-edit
 * write-back. It holds no enrichment logic — the orchestrator owns that; the
 * preview only reflects what's on disk and lets the user correct it.
 *
 * `rowsVersion` is the orchestrator's `rows-changed` counter from the store; a
 * bump means a batch landed, so we re-read. Edits the user makes while a run is
 * in flight are debounced to disk; the next reload merges them with landed rows
 * because the orchestrator only fills *empty* fields (idempotent by `needsEnrich`).
 */
export function useImportData(budgetPath: string, staging: StagingStore, rowsVersion: number) {
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accountMapping, setAccountMapping] = useState<EntityMapping>({});
  const [loading, setLoading] = useState(true);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [], isSuccess: categoriesLoaded } = useCategories();

  const repository = useImportRepository(budgetPath);

  // ── Write-back debounce ──────────────────────────────────────
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef(transactions);
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

  const writeBack = useCallback(async () => {
    try {
      await staging.writeTransactions(transactionsRef.current);
    } catch (err) {
      console.error("[import] write staging failed:", err);
    }
  }, [staging]);

  const scheduleWriteBack = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(writeBack, 500);
  }, [writeBack]);

  const flushWriteBack = useCallback(async () => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
      await writeBack();
    }
  }, [writeBack]);

  useEffect(() => () => { void flushWriteBack(); }, [flushWriteBack]);

  // ── Load staging ─────────────────────────────────────────────
  const loadCsv = useCallback(async () => {
    const rows = (await staging.readTransactions()) ?? [];
    setTransactions(rows);
    setSelectedIds(new Set(rows.filter((r) => !r.duplicate).map((r) => r.id)));
    setLoading(false);
  }, [staging]);

  // Reload on mount and whenever a batch lands (rowsVersion bump). A pending
  // hand-edit is flushed first so the reload doesn't clobber it.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      await flushWriteBack();
      if (cancelled) return;
      await loadCsv();
    }
    void reload();
    return () => { cancelled = true; };
  }, [loadCsv, flushWriteBack, rowsVersion]);

  // ── Category validation + account mapping ────────────────────
  const mappingAppliedRef = useRef(false);
  useEffect(() => {
    // Gate on categories being *loaded* too, not just accounts: latching before
    // the categories query resolves would skip the category-id validation below,
    // leaving persisted ids of deleted categories in place (and `needsEnrich`
    // would treat those rows as complete).
    if (
      mappingAppliedRef.current ||
      transactions.length === 0 ||
      accounts.length === 0 ||
      !categoriesLoaded
    )
      return;
    mappingAppliedRef.current = true;

    async function applyMappings() {
      const accountIds = new Set(accounts.map((a) => a.id));
      const categoryIds = new Set(categories.map((c) => c.id));

      // 1. Account mapping the engine already resolved onto each row.
      const aiMapping: EntityMapping = {};
      for (const txn of transactions) {
        if (txn.sourceAccount && !aiMapping[txn.sourceAccount] && txn.accountId && accountIds.has(txn.accountId)) {
          aiMapping[txn.sourceAccount] = txn.accountId;
        }
      }

      // 2. Direct name match — sourceAccount against existing account names.
      const sourceAccountNames = [...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean))];
      const nameMapping: EntityMapping = matchAccountsByName(sourceAccountNames, accounts);

      // 3. Drop any category id no longer in the budget (deleted between runs).
      if (categoryIds.size > 0) {
        let needsFix = false;
        const validated = transactions.map((t) => {
          if (t.categoryId && !categoryIds.has(t.categoryId)) {
            needsFix = true;
            return { ...t, categoryId: "", categoryConfidence: "" };
          }
          return t;
        });
        if (needsFix) {
          setTransactions(validated);
          scheduleWriteBack();
        }
      }

      // 4. Overlay saved aliases (the user's past mappings win).
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
        /* no aliases file */
      }

      const merged = { ...aiMapping, ...nameMapping, ...aliasMapping };
      if (Object.keys(merged).length > 0) setAccountMapping(merged);
    }

    void applyMappings();
  }, [transactions, accounts, categories, categoriesLoaded, repository, scheduleWriteBack]);

  // ── Edits ────────────────────────────────────────────────────
  const handleUpdate = useCallback(
    (id: string, patch: Partial<ImportTransaction>) => {
      setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      scheduleWriteBack();
    },
    [scheduleWriteBack],
  );

  const handleAccountMappingChange = useCallback(
    (newMapping: EntityMapping) => {
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
    },
    [scheduleWriteBack],
  );

  // ── Derived ──────────────────────────────────────────────────
  const sourceAccounts = useMemo(
    () => [...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean))].sort(),
    [transactions],
  );

  /** Ids the engine flagged as duplicates of existing budget rows. Persisted by
   *  grounding — the app doesn't re-detect. */
  const duplicateIds = useMemo(
    () => new Set(transactions.filter((t) => t.duplicate).map((t) => t.id)),
    [transactions],
  );

  const uncategorizedCount = useMemo(
    () => transactions.filter((t) => !t.categoryId && t.type !== "transfer" && !t.duplicate).length,
    [transactions],
  );

  const lowConfidenceCount = useMemo(
    () => transactions.filter((t) => t.categoryConfidence === "low").length,
    [transactions],
  );

  /** Rows still needing the classifier — gates the Enrich button. Mirrors the
   *  orchestrator's own predicate so the UI agrees with what a re-run would do. */
  const incompleteCount = useMemo(
    () => transactions.filter(needsEnrich).length,
    [transactions],
  );

  return {
    transactions,
    selectedIds,
    setSelectedIds,
    accountMapping,
    loading,
    handleUpdate,
    handleAccountMappingChange,
    flushWriteBack,
    sourceAccounts,
    duplicateIds,
    uncategorizedCount,
    lowConfidenceCount,
    incompleteCount,
    accounts,
    categories,
  };
}
