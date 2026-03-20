import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { useImportPaths } from "@/hooks/use-import-paths";
import { useEnrichSession } from "@/hooks/use-enrich-session";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { parseCsv, unparseCsv } from "@capybudget/persistence";
import { formatMoney } from "@capybudget/core";
import type { ImportTransaction } from "@capybudget/core";
import {
  ImportTable,
  sortImportTransactions,
  filterImportTransactions,
  type ImportSortConfig,
} from "./import-table";
import { ImportMapping, type EntityMapping } from "./import-mapping";
import { Search, X, FileUp, Sparkles, Loader2, GitMerge, AlertTriangle } from "lucide-react";

const IMPORT_COERCE = { amount: (v: string) => parseInt(v, 10) };

/** Stored in .capy/aliases.json — survives across imports. */
interface ImportAliases {
  accounts: Record<string, string>; // sourceString → accountId | "__create__"
}

interface ImportPreviewProps {
  budgetPath: string;
  budgetName: string;
}

export function ImportPreview({ budgetPath, budgetName }: ImportPreviewProps) {
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<ImportSortConfig>({
    column: "date",
    direction: "asc",
  });
  const [search, setSearch] = useState("");
  const [accountMapping, setAccountMapping] = useState<EntityMapping>({});
  const [loading, setLoading] = useState(true);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  // Write-back debounce
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef(transactions);
  useEffect(() => { transactionsRef.current = transactions; }, [transactions]);

  const { resolveImportPath, resolveAliasPath } = useImportPaths(budgetPath);
  const customInstructions = useCustomInstructions(budgetPath);

  // ── Load / reload CSV ──────────────────────────────────────────
  const loadCsv = useCallback(async () => {
    try {
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
      setTransactions(parsed);
      setSelectedIds(new Set(parsed.map((t) => t.id)));
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [resolveImportPath]);

  const writeBack = useCallback(async () => {
    try {
      const csvPath = await resolveImportPath("transactions.csv");
      const csv = unparseCsv(transactionsRef.current);
      await writeTextFile(csvPath, csv);
    } catch (err) {
      console.error("Failed to write import CSV:", err);
    }
  }, [resolveImportPath]);

  const scheduleWriteBack = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(writeBack, 500);
  }, [writeBack]);

  // ── Re-enrichment session ──────────────────────────────────────
  const enrichSession = useEnrichSession({
    budgetPath,
    budgetName,
    mcpServerPath: "packages/mcp/src/server.ts",
    customInstructions: customInstructions.instructions,
    onEnrichmentComplete: loadCsv,
  });

  const handleEnrich = useCallback(async () => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      await writeBack();
    }
    enrichSession.startEnrichment("");
  }, [writeBack, enrichSession]);

  // Auto-enrich: trigger enrichment once after first load if data hasn't been enriched yet
  const autoEnrichTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      autoEnrichTriggeredRef.current ||
      loading ||
      transactions.length === 0 ||
      enrichSession.isEnriching
    ) return;
    // Check if any merchant is set — if none, enrichment hasn't run
    const needsEnrich = transactions.every((t) => !t.merchant);
    if (needsEnrich) {
      autoEnrichTriggeredRef.current = true;
      enrichSession.startEnrichment("");
    }
  }, [loading, transactions, enrichSession]);

  // Load CSV on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
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
        if (!cancelled) {
          setTransactions(parsed);
          setSelectedIds(new Set(parsed.map((t) => t.id)));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [resolveImportPath]);

  // ── Derive account mapping from CSV + aliases ──────────────────
  const aliasesAppliedRef = useRef(false);
  useEffect(() => {
    if (aliasesAppliedRef.current || transactions.length === 0 || accounts.length === 0) return;
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
      }

      // 3. Overlay aliases (user's past mappings override AI)
      const aliasMapping: EntityMapping = {};
      try {
        const aliasPath = await resolveAliasPath();
        const content = await readTextFile(aliasPath);
        const aliases: ImportAliases = JSON.parse(content);

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
  }, [transactions, accounts, categories, resolveAliasPath]);

  // Flush pending CSV write on unmount
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeBack();
      }
    };
  }, [writeBack]);

  // ── Derived data ───────────────────────────────────────────────
  const sourceAccounts = useMemo(
    () =>
      [
        ...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean)),
      ].sort(),
    [transactions],
  );

  const filtered = useMemo(
    () => filterImportTransactions(transactions, search),
    [transactions, search],
  );
  const sorted = useMemo(
    () => sortImportTransactions(filtered, sort),
    [filtered, sort],
  );

  // Issues counts
  const uncategorizedCount = useMemo(
    () => transactions.filter((t) => !t.categoryId && t.type !== "transfer").length,
    [transactions],
  );
  const lowConfidenceCount = useMemo(
    () => transactions.filter((t) => t.categoryConfidence === "low").length,
    [transactions],
  );

  // Selection helpers
  const allSelected =
    sorted.length > 0 && sorted.every((t) => selectedIds.has(t.id));
  const indeterminate =
    !allSelected && sorted.some((t) => selectedIds.has(t.id));

  const lastToggledRef = useRef<string | null>(null);

  const handleToggleSelect = useCallback(
    (id: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastToggledRef.current) {
          const ids = sorted.map((t) => t.id);
          const from = ids.indexOf(lastToggledRef.current);
          const to = ids.indexOf(id);
          if (from !== -1 && to !== -1) {
            const [start, end] = from < to ? [from, to] : [to, from];
            const shouldSelect = !prev.has(id);
            for (let i = start; i <= end; i++) {
              if (shouldSelect) next.add(ids[i]);
              else next.delete(ids[i]);
            }
          }
        } else {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        lastToggledRef.current = id;
        return next;
      });
    },
    [sorted],
  );

  const handleToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const visibleIds = sorted.map((t) => t.id);
      const allChecked = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (allChecked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [sorted]);

  // Mutation handlers
  const handleUpdate = useCallback(
    (id: string, patch: Partial<ImportTransaction>) => {
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
      scheduleWriteBack();
    },
    [scheduleWriteBack],
  );

  // Account mapping change → batch-update accountId on all matching rows
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

  // Stats
  const selected = transactions.filter((t) => selectedIds.has(t.id));
  const selectedCount = selected.length;
  const totalCount = transactions.length;
  const selectedTotal = selected.reduce((sum, t) => sum + t.amount, 0);

  // Merge confirmation
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const newAccountCount = sourceAccounts.filter(
    (s) => !accountMapping[s] || accountMapping[s] === "__create__",
  ).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FileUp className="h-12 w-12 mb-3 text-muted-foreground/30" />
        <p className="text-base font-medium text-foreground/80">
          No transactions found
        </p>
        <p className="mt-1.5 text-sm text-muted-foreground/60">
          The import didn't produce any transactions. Cancel the import to start
          over.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Stats bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {selectedCount}
          </span>{" "}
          of <span className="tabular-nums">{totalCount}</span> transactions
          selected for import
        </p>
      </div>

      {/* Enriching indicator */}
      {enrichSession.isEnriching && (
        <div className="rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-2 text-sm text-foreground/70 space-y-1">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand shrink-0" />
            <span>Enriching — identifying merchants and categories…</span>
          </div>
          {enrichSession.statusText && (
            <p className="text-xs text-muted-foreground/60 truncate pl-6">
              {enrichSession.statusText}
            </p>
          )}
        </div>
      )}

      {/* Account mapping section */}
      <ImportMapping
        sourceAccounts={sourceAccounts}
        accounts={accounts}
        accountMapping={accountMapping}
        onAccountMappingChange={handleAccountMappingChange}
      />

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div
          className={`relative flex-1 min-w-0 ${search ? "ring-1 ring-brand/30 rounded-lg" : ""}`}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Search imported transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Issues banner */}
      {(uncategorizedCount > 0 || lowConfidenceCount > 0) && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2 text-sm text-foreground/70">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>
            {[
              uncategorizedCount > 0 &&
                `${uncategorizedCount} uncategorized`,
              lowConfidenceCount > 0 &&
                `${lowConfidenceCount} low confidence`,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </div>
      )}

      {/* Transaction table */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <ImportTable
          transactions={sorted}
          sort={sort}
          onSortChange={setSort}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onToggleAll={handleToggleAll}
          allSelected={allSelected}
          indeterminate={indeterminate}
          onUpdateTransaction={handleUpdate}
          categories={categories}
        />
      </div>

      {/* ── Floating action bar ──────────────────────────────── */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-xl px-4 py-2.5">
            {/* Summary */}
            <div className="flex items-center gap-3 border-r border-border/40 pr-3">
              <span className="text-sm font-medium tabular-nums">
                {selectedCount} selected
              </span>
              <span className="text-sm text-muted-foreground tabular-nums font-semibold">
                {formatMoney(selectedTotal)}
              </span>
            </div>

            {/* Re-enrich button */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={enrichSession.isEnriching}
              onClick={handleEnrich}
            >
              {enrichSession.isEnriching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {enrichSession.isEnriching ? "Enriching…" : "Enrich"}
            </Button>

            {/* Merge button */}
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setShowMergeDialog(true)}
            >
              <GitMerge className="h-3.5 w-3.5" />
              Merge
            </Button>

            {/* Dismiss */}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-1 text-muted-foreground/60 hover:text-foreground transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Merge confirmation dialog ────────────────────── */}
      {showMergeDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setShowMergeDialog(false);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Merge {selectedCount} transactions?</DialogTitle>
              <DialogDescription>
                <span className="space-y-2 block">
                  <span className="block">
                    This will add{" "}
                    <strong>
                      {selectedCount} transaction
                      {selectedCount !== 1 ? "s" : ""}
                    </strong>{" "}
                    ({formatMoney(selectedTotal)}) to your budget.
                  </span>
                  {newAccountCount > 0 && (
                    <span className="block">
                      {newAccountCount} new account
                      {newAccountCount > 1 ? "s" : ""} will be created.
                    </span>
                  )}
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowMergeDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowMergeDialog(false);
                  // TODO: implement merge (7.7)
                }}
                className="gap-1.5"
              >
                <GitMerge className="h-3.5 w-3.5" />
                Merge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
