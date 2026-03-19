import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
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
import {
  Search,
  X,
  FileUp,
  Sparkles,
  Loader2,
  GitMerge,
  AlertCircle,
} from "lucide-react";

const IMPORT_COERCE = { amount: (v: string) => parseInt(v, 10) };

/** Stored in .capy/aliases.json — survives across imports. */
interface ImportAliases {
  accounts: Record<string, string>; // sourceString → accountId | "__create__"
  categories: Record<string, string>; // sourceString → categoryId | "__create__"
}

interface ImportPreviewProps {
  budgetPath: string;
}

export function ImportPreview({ budgetPath }: ImportPreviewProps) {
  const [transactions, setTransactions] = useState<ImportTransaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<ImportSortConfig>({
    column: "date",
    direction: "asc",
  });
  const [search, setSearch] = useState("");
  const [accountMapping, setAccountMapping] = useState<EntityMapping>({});
  const [categoryMapping, setCategoryMapping] = useState<EntityMapping>({});
  const [loading, setLoading] = useState(true);

  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();

  // Write-back debounce
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;

  const resolveImportPath = useCallback(
    async (filename: string) => {
      const capyDir = await joinPath(budgetPath, ".capy");
      const importDir = await joinPath(capyDir, "import");
      return joinPath(importDir, filename);
    },
    [budgetPath],
  );

  const resolveAliasPath = useCallback(async () => {
    const capyDir = await joinPath(budgetPath, ".capy");
    return joinPath(capyDir, "aliases.json");
  }, [budgetPath]);

  /** Save current mappings as aliases for future imports. */
  const saveAliases = useCallback(async () => {
    try {
      const path = await resolveAliasPath();
      const aliases: ImportAliases = {
        accounts: { ...accountMapping },
        categories: { ...categoryMapping },
      };
      await writeTextFile(path, JSON.stringify(aliases, null, 2));
      console.log("[import] aliases saved", aliases);
    } catch (err) {
      console.warn("[import] failed to save aliases:", err);
    }
  }, [resolveAliasPath, accountMapping, categoryMapping]);

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

  // Load CSV on mount (runs once)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const csvPath = await resolveImportPath("transactions.csv");
        const content = await readTextFile(csvPath);
        const parsed = parseCsv<ImportTransaction>(content, IMPORT_COERCE);
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

  // Pre-populate mappings from aliases (runs when budget data is ready)
  const aliasesAppliedRef = useRef(false);
  useEffect(() => {
    // Wait until both transactions and budget data are loaded, apply once
    if (aliasesAppliedRef.current || transactions.length === 0 || accounts.length === 0) return;
    aliasesAppliedRef.current = true;

    async function applyAliases() {
      try {
        const aliasPath = await resolveAliasPath();
        const content = await readTextFile(aliasPath);
        const aliases: ImportAliases = JSON.parse(content);

        const importAccounts = new Set(transactions.map((t) => t.sourceAccount).filter(Boolean));
        const importCategories = new Set(transactions.map((t) => t.sourceCategory).filter(Boolean));

        const accountIds = new Set(accounts.map((a) => a.id));
        const categoryIds = new Set(categories.map((c) => c.id));

        const validAccounts: EntityMapping = {};
        if (aliases.accounts && typeof aliases.accounts === "object") {
          for (const [source, targetId] of Object.entries(aliases.accounts)) {
            if (!importAccounts.has(source)) continue;
            if (targetId === "__create__" || accountIds.has(targetId)) {
              validAccounts[source] = targetId;
            }
          }
        }

        const validCategories: EntityMapping = {};
        if (aliases.categories && typeof aliases.categories === "object") {
          for (const [source, targetId] of Object.entries(aliases.categories)) {
            if (!importCategories.has(source)) continue;
            if (targetId === "__create__" || categoryIds.has(targetId)) {
              validCategories[source] = targetId;
            }
          }
        }

        if (Object.keys(validAccounts).length > 0) {
          console.log("[import] pre-populated account mappings:", validAccounts);
          setAccountMapping(validAccounts);
        }
        if (Object.keys(validCategories).length > 0) {
          console.log("[import] pre-populated category mappings:", validCategories);
          setCategoryMapping(validCategories);
        }
      } catch {
        // No aliases file — user maps manually
      }
    }

    applyAliases();
  }, [transactions, accounts, categories, resolveAliasPath]);

  // Flush CSV + save aliases on unmount
  const saveAliasesRef = useRef(saveAliases);
  saveAliasesRef.current = saveAliases;
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeBack();
      }
      saveAliasesRef.current();
    };
  }, [writeBack]);

  // Derived data
  const sourceAccounts = useMemo(
    () =>
      [
        ...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean)),
      ].sort(),
    [transactions],
  );
  const sourceCategories = useMemo(
    () =>
      [
        ...new Set(transactions.map((t) => t.sourceCategory).filter(Boolean)),
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

  // Stats
  const selected = transactions.filter((t) => selectedIds.has(t.id));
  const selectedCount = selected.length;
  const totalCount = transactions.length;
  const selectedTotal = selected.reduce((sum, t) => sum + t.amount, 0);

  // Mapping completeness check
  const unmappedAccounts = sourceAccounts.filter(
    (s) => !(s in accountMapping),
  );
  const unmappedCategories = sourceCategories.filter(
    (s) => !(s in categoryMapping),
  );
  const allMapped =
    unmappedAccounts.length === 0 && unmappedCategories.length === 0;

  const missingItems: string[] = [];
  if (unmappedAccounts.length > 0)
    missingItems.push(
      `${unmappedAccounts.length} account${unmappedAccounts.length > 1 ? "s" : ""}`,
    );
  if (unmappedCategories.length > 0)
    missingItems.push(
      `${unmappedCategories.length} categor${unmappedCategories.length > 1 ? "ies" : "y"}`,
    );

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
          The normalization didn't produce any transactions. Cancel the import
          to start over.
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

      {/* Mapping section */}
      <ImportMapping
        sourceAccounts={sourceAccounts}
        sourceCategories={sourceCategories}
        accounts={accounts}
        categories={categories}
        accountMapping={accountMapping}
        categoryMapping={categoryMapping}
        onAccountMappingChange={setAccountMapping}
        onCategoryMappingChange={setCategoryMapping}
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

            {/* Enrich (magic) button */}
            <Button size="sm" variant="outline" className="gap-1.5" disabled>
              <Sparkles className="h-3.5 w-3.5" />
              Enrich
            </Button>

            {/* Merge button */}
            {allMapped ? (
              <Button size="sm" className="gap-1.5" disabled>
                <GitMerge className="h-3.5 w-3.5" />
                Merge
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        Merge
                      </Button>
                    </span>
                  }
                />
                <TooltipContent>
                  <div className="flex items-start gap-1.5 max-w-xs">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                      Map {missingItems.join(" and ")} before merging
                    </span>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

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
    </div>
  );
}
