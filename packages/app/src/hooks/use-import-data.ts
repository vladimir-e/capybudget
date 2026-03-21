import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccounts, useCategories, useTransactions } from "@/hooks/use-budget-data";
import { useImportRepository } from "@/hooks/use-import-repository";
import { detectDuplicates } from "@capybudget/core";
import type { ImportTransaction, ImportAliases, DuplicateMatch } from "@capybudget/core";
import type { EntityMapping } from "@/components/import/import-mapping";

/**
 * Owns the import preview data lifecycle:
 * - Loads CSV on mount (via repository, with validation)
 * - Validates categories, applies alias overlay
 * - Manages transaction state + debounced write-back
 * - Manages account mapping with batch accountId updates
 * - Checks state.json enriched flag for auto-enrich trigger
 */
export function useImportData(budgetPath: string) {
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accountMapping, setAccountMapping] = useState<EntityMapping>({});
  const [loading, setLoading] = useState(true);
  const [needsEnrichment, setNeedsEnrichment] = useState(false);

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
  const [loadGeneration, setLoadGeneration] = useState(0);
  const loadCsv = useCallback(async () => {
    try {
      const parsed = await repository.readTransactionsCsv();
      setTransactions(parsed);
      setSelectedIds(new Set(parsed.map((t) => t.id)));
      setLoadGeneration((g) => g + 1);
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

  // ── Check enrichment flag from state.json ────────────────────
  useEffect(() => {
    if (loading || transactions.length === 0) return;
    let cancelled = false;
    async function checkEnriched() {
      const state = await repository.readState();
      if (!cancelled && !state.enriched) {
        setNeedsEnrichment(true);
      }
    }
    checkEnriched();
    return () => { cancelled = true; };
  }, [loading, transactions.length, repository]);

  const markEnriched = useCallback(async () => {
    setNeedsEnrichment(false);
    const state = await repository.readState();
    await repository.writeState({ ...state, enriched: true });
  }, [repository]);

  // ── Category validation + alias overlay ──────────────────────
  const aliasesAppliedRef = useRef(false);
  useEffect(() => {
    if (aliasesAppliedRef.current || transactions.length === 0 || accounts.length === 0 || categories.length === 0) return;
    aliasesAppliedRef.current = true;

    async function applyMappings() {
      const accountIds = new Set(accounts.map((a) => a.id));
      const categoryIds = new Set(categories.map((c) => c.id));

      // 1. Derive initial account mapping from AI-set accountId values
      const aiMapping: EntityMapping = {};
      for (const txn of transactions) {
        if (txn.sourceAccount && !aiMapping[txn.sourceAccount] && txn.accountId) {
          if (accountIds.has(txn.accountId)) {
            aiMapping[txn.sourceAccount] = txn.accountId;
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

      // 3. Overlay aliases (user's past mappings override AI)
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

      // Merge: aliases override AI suggestions
      const merged = { ...aiMapping, ...aliasMapping };
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

  // ── Duplicate detection ────────────────────────────────────────
  const duplicates = useMemo<Map<string, DuplicateMatch>>(
    () => detectDuplicates(transactions, existingTransactions, accountMapping),
    [transactions, existingTransactions, accountMapping],
  );

  // Auto-unselect duplicates once per load cycle
  const duplicatesAppliedForGenRef = useRef(-1);
  useEffect(() => {
    if (duplicatesAppliedForGenRef.current === loadGeneration || duplicates.size === 0 || loading) return;
    duplicatesAppliedForGenRef.current = loadGeneration;

    async function unselectDuplicates() {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of duplicates.keys()) {
          next.delete(id);
        }
        return next;
      });
    }
    unselectDuplicates();
  }, [duplicates, loading, loadGeneration]);

  return {
    // State
    transactions,
    selectedIds,
    setSelectedIds,
    accountMapping,
    loading,
    needsEnrichment,

    // Actions
    loadCsv,
    handleUpdate,
    handleAccountMappingChange,
    flushWriteBack,
    markEnriched,

    // Derived
    sourceAccounts,
    uncategorizedCount,
    lowConfidenceCount,
    duplicates,
    accounts,
    categories,
  };
}
