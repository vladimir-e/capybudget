import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";
import { Input } from "@/components/ui/input";
import { useAccounts, useCategories } from "@/hooks/use-budget-data";
import { parseCsv, unparseCsv } from "@capybudget/persistence";
import type { ImportTransaction } from "@capybudget/core";
import {
  ImportTable,
  sortImportTransactions,
  filterImportTransactions,
  type ImportSortConfig,
} from "./import-table";
import { ImportMapping, type EntityMapping } from "./import-mapping";
import { Search, X, FileUp } from "lucide-react";

const IMPORT_COERCE = { amount: (v: string) => parseInt(v, 10) };

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

  const writeBack = useCallback(async () => {
    try {
      const csvPath = await joinPath(
        budgetPath,
        ".capy",
        "import",
        "transactions.csv",
      );
      const csv = unparseCsv(transactionsRef.current);
      await writeTextFile(csvPath, csv);
    } catch (err) {
      console.error("Failed to write import CSV:", err);
    }
  }, [budgetPath]);

  const scheduleWriteBack = useCallback(() => {
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(writeBack, 500);
  }, [writeBack]);

  // Load CSV on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const csvPath = await joinPath(
          budgetPath,
          ".capy",
          "import",
          "transactions.csv",
        );
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
    return () => {
      cancelled = true;
    };
  }, [budgetPath]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeBack();
      }
    };
  }, [writeBack]);

  // Derived data
  const sourceAccounts = useMemo(
    () => [...new Set(transactions.map((t) => t.sourceAccount).filter(Boolean))].sort(),
    [transactions],
  );
  const sourceCategories = useMemo(
    () => [...new Set(transactions.map((t) => t.sourceCategory).filter(Boolean))].sort(),
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

  const handleDelete = useCallback(
    (id: string) => {
      setTransactions((prev) => prev.filter((t) => t.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      scheduleWriteBack();
    },
    [scheduleWriteBack],
  );

  // Stats
  const selectedCount = sorted.filter((t) => selectedIds.has(t.id)).length;
  const totalCount = transactions.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading import data...
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
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">
            {selectedCount}
          </span>{" "}
          of{" "}
          <span className="tabular-nums">{totalCount}</span> transactions
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
          onDeleteTransaction={handleDelete}
        />
      </div>
    </div>
  );
}
