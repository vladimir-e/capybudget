import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { useImportMerge } from "@/hooks/use-import-merge";
import { useImportData } from "@/hooks/use-import-data";
import type { StagingStore } from "@capybudget/intelligence";
import { formatMoney } from "@capybudget/core";
import { ImportTable } from "./import-table";
import {
  sortImportTransactions,
  filterImportTransactions,
  type ImportSortConfig,
} from "@/components/import/import-table-utils";
import { ImportMapping } from "./import-mapping";
import { Search, X, GitMerge, AlertTriangle, Copy, Sparkles, Loader2, Square } from "lucide-react";

interface ImportPreviewProps {
  budgetPath: string;
  /** The shared staging store the orchestrator writes to — read source of truth. */
  staging: StagingStore;
  /** Bumped each time a batch lands; triggers a staging reload. */
  rowsVersion: number;
  /** True while a run is in flight — the table is read-only and Stop replaces Enrich. */
  running: boolean;
  /** Interrupt the in-flight run (Stop). */
  onStop: () => void;
  /** Re-run Categorizing over the incomplete remainder (Enrich). */
  onEnrich: () => void;
  onMergeComplete: () => void;
}

export function ImportPreview({
  budgetPath,
  staging,
  rowsVersion,
  running,
  onStop,
  onEnrich,
  onMergeComplete,
}: ImportPreviewProps) {
  const [sort, setSort] = useState<ImportSortConfig>({ column: "date", direction: "asc" });
  const [search, setSearch] = useState("");

  const {
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
  } = useImportData(budgetPath, staging, rowsVersion);

  const handleEnrich = useCallback(async () => {
    await flushWriteBack();
    onEnrich();
  }, [flushWriteBack, onEnrich]);

  // ── Filtering / sorting ────────────────────────────────────────
  const filtered = useMemo(
    () => filterImportTransactions(transactions, search),
    [transactions, search],
  );
  const sorted = useMemo(() => sortImportTransactions(filtered, sort), [filtered, sort]);

  // ── Selection helpers ──────────────────────────────────────────
  const allSelected = sorted.length > 0 && sorted.every((t) => selectedIds.has(t.id));
  const indeterminate = !allSelected && sorted.some((t) => selectedIds.has(t.id));
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
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        lastToggledRef.current = id;
        return next;
      });
    },
    [sorted, setSelectedIds],
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
  }, [sorted, setSelectedIds]);

  // ── Stats ──────────────────────────────────────────────────────
  const selected = transactions.filter((t) => selectedIds.has(t.id));
  const selectedCount = selected.length;
  const totalCount = transactions.length;
  const selectedTotal = selected.reduce((sum, t) => sum + t.amount, 0);

  // ── Merge ──────────────────────────────────────────────────────
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [merging, setMerging] = useState(false);
  const { merge } = useImportMerge(budgetPath);

  const newAccountCount = sourceAccounts.filter(
    (s) => !accountMapping[s] || accountMapping[s] === "__create__",
  ).length;

  const handleMerge = useCallback(async () => {
    setShowMergeDialog(false);
    setMerging(true);
    try {
      await flushWriteBack();
      const result = await merge({ transactions, selectedIds, accountMapping });
      toast.success(
        `Merged ${result.transactionCount} transaction${result.transactionCount !== 1 ? "s" : ""}` +
          (result.accountsCreated > 0
            ? ` and created ${result.accountsCreated} account${result.accountsCreated !== 1 ? "s" : ""}`
            : ""),
      );
      onMergeComplete();
    } catch (err) {
      toast.error(`Merge failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setMerging(false);
    }
  }, [merge, transactions, selectedIds, accountMapping, onMergeComplete, flushWriteBack]);

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Selection summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{selectedCount}</span> of{" "}
          <span className="tabular-nums">{totalCount}</span> transactions selected for import
        </p>
      </div>

      {/* Account mapping */}
      <ImportMapping
        sourceAccounts={sourceAccounts}
        accounts={accounts}
        accountMapping={accountMapping}
        onAccountMappingChange={handleAccountMappingChange}
      />

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className={`relative flex-1 min-w-0 ${search ? "ring-1 ring-brand/30 rounded-lg" : ""}`}>
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

      {/* Duplicates banner */}
      {duplicateIds.size > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3.5 py-2 text-sm text-foreground/70">
          <Copy className="h-3.5 w-3.5 text-blue-500 shrink-0" />
          <span>
            {duplicateIds.size} duplicate{duplicateIds.size !== 1 ? "s" : ""} detected — already unselected
          </span>
        </div>
      )}

      {/* Issues banner (hidden during a run — counts are still settling) */}
      {!running && (uncategorizedCount > 0 || lowConfidenceCount > 0) && (
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3.5 py-2 text-sm text-foreground/70">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>
            {[
              uncategorizedCount > 0 && `${uncategorizedCount} uncategorized`,
              lowConfidenceCount > 0 && `${lowConfidenceCount} low confidence`,
            ]
              .filter(Boolean)
              .join(", ")}
          </span>
        </div>
      )}

      {/* Table — read-only while a run is in flight (rows are filling in live) */}
      <div className={`rounded-xl border border-border/40 overflow-hidden ${running ? "pointer-events-none opacity-90" : ""}`}>
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
          accounts={accounts}
          accountMapping={accountMapping}
          duplicateIds={duplicateIds}
        />
      </div>

      {/* Floating action bar — always present; Merge gates on selection */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-overlay px-4 py-2.5">
          <div className="flex items-center gap-3 border-r border-border/40 pr-3">
            <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
            <span className="text-sm text-muted-foreground tabular-nums font-semibold">
              {formatMoney(selectedTotal)}
            </span>
          </div>

          {running ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onStop}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={incompleteCount === 0}
              onClick={handleEnrich}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Enrich{incompleteCount > 0 ? ` ${incompleteCount}` : ""}
            </Button>
          )}

          <Button
            size="sm"
            className="gap-1.5"
            disabled={merging || selectedCount === 0}
            onClick={() => setShowMergeDialog(true)}
          >
            {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
            {merging ? "Merging…" : "Merge"}
          </Button>
        </div>
      </div>

      {/* Merge confirmation */}
      {showMergeDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowMergeDialog(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Merge {selectedCount} transactions?</DialogTitle>
              <DialogDescription>
                <span className="space-y-2 block">
                  <span className="block">
                    This will add{" "}
                    <strong>
                      {selectedCount} transaction{selectedCount !== 1 ? "s" : ""}
                    </strong>{" "}
                    ({formatMoney(selectedTotal)}) to your budget.
                  </span>
                  {newAccountCount > 0 && (
                    <span className="block">
                      {newAccountCount} new account{newAccountCount > 1 ? "s" : ""} will be created.
                    </span>
                  )}
                </span>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMergeDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleMerge} className="gap-1.5">
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
