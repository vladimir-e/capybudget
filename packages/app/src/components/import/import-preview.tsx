import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTransactions } from "@/hooks/use-budget-data";
import { summarizeMerge } from "@capybudget/core";
import type { StagingStore } from "@capybudget/intelligence";
import { useFormatMoney } from "@/contexts/currency-context";
import { ImportTable } from "./import-table";
import {
  sortImportTransactions,
  filterImportTransactions,
  type ImportSortConfig,
} from "@/components/import/import-table-utils";
import { ImportMappingRows, type MappingRowMeta } from "./import-mapping";
import { Search, X, GitMerge, AlertTriangle, Copy, Loader2 } from "lucide-react";

interface ImportPreviewProps {
  budgetPath: string;
  /** The shared staging store the orchestrator writes to — read source of truth. */
  staging: StagingStore;
  /** Bumped each time a batch lands; triggers a staging reload. */
  rowsVersion: number;
  /** True while a run is in flight — the table is read-only and Merge is gated. */
  running: boolean;
  /** Fully stop + detach the in-flight run. Called before a merge so no batch
   *  can write `transactions.csv` after the merge clears staging (the same race
   *  class as Cancel). Resolves once nothing is in flight; no-op when idle. */
  onStopRun: () => Promise<void>;
  /** Re-run Categorizing over the incomplete remainder (Enrich). */
  onEnrich: () => void;
  /** Reports the live enrichable remainder + a flush-then-enrich trigger, for
   *  the progress section's Enrich control (the preview owns the data, the
   *  control renders above it). Called with null on unmount. */
  onEnrichControl: (control: { count: number; run: () => void } | null) => void;
  onMergeComplete: () => void;
}

export function ImportPreview({
  budgetPath,
  staging,
  rowsVersion,
  running,
  onStopRun,
  onEnrich,
  onEnrichControl,
  onMergeComplete,
}: ImportPreviewProps) {
  const { format } = useFormatMoney();
  const { data: budgetTransactions = [] } = useTransactions();
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
    possibleDuplicateCount,
    uncategorizedCount,
    lowConfidenceCount,
    incompleteCount,
    accounts,
    categories,
  } = useImportData(budgetPath, staging, rowsVersion);

  // A pending hand-edit must reach staging before the orchestrator re-reads it
  // — enrich snapshots staging, so an unflushed edit would be clobbered.
  const handleEnrich = useCallback(async () => {
    await flushWriteBack();
    onEnrich();
  }, [flushWriteBack, onEnrich]);

  useEffect(() => {
    onEnrichControl({ count: incompleteCount, run: () => void handleEnrich() });
    return () => onEnrichControl(null);
  }, [incompleteCount, handleEnrich, onEnrichControl]);

  // ── Filtering / sorting ────────────────────────────────────────
  const filtered = useMemo(
    () => filterImportTransactions(transactions, search, format),
    [transactions, search, format],
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
  const certainDuplicateCount = duplicateIds.size - possibleDuplicateCount;

  // ── Merge ──────────────────────────────────────────────────────
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showMappingDialog, setShowMappingDialog] = useState(false);
  const [merging, setMerging] = useState(false);
  const { merge } = useImportMerge(budgetPath);

  const newAccountCount = sourceAccounts.filter(
    (s) => !accountMapping[s] || accountMapping[s] === "__create__",
  ).length;

  // Per-source-account preview of the pending merge — same inputs handleMerge
  // passes to `merge`, so what's shown is exactly what lands. Recomputes when the
  // mapping is edited at the gate. Only runs while the confirmation is open.
  const mergeSummary = useMemo(() => {
    if (!showMergeDialog || selectedIds.size === 0) {
      return { rows: [], unmappedTransferCount: 0 };
    }
    return summarizeMerge(
      { transactions, selectedIds, accountMapping },
      accounts,
      budgetTransactions,
    );
  }, [showMergeDialog, transactions, selectedIds, accountMapping, accounts, budgetTransactions]);

  const rowMeta = useMemo(() => {
    const meta: Record<string, MappingRowMeta> = {};
    for (const row of mergeSummary.rows) {
      meta[row.sourceAccount] = {
        resultingBalance: row.resultingBalance,
        isNew: row.isNew,
        count: row.count,
      };
    }
    return meta;
  }, [mergeSummary]);

  const handleMerge = useCallback(async () => {
    setShowMergeDialog(false);
    setMerging(true);
    try {
      // Stop + detach any in-flight run before merge clears staging — otherwise
      // a late Categorizing batch writes transactions.csv after the clear and
      // resurrects the import (or lets it merge twice).
      await onStopRun();
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
  }, [merge, transactions, selectedIds, accountMapping, onMergeComplete, flushWriteBack, onStopRun]);

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const showDuplicatesNote = duplicateIds.size > 0;
  // Issue counts are still settling while a run is in flight.
  const showIssuesNote = !running && (uncategorizedCount > 0 || lowConfidenceCount > 0);

  return (
    <div className="space-y-5 pb-20">
      {/* Run notes — one compact panel, a line per note. Certain duplicate
          matches and the speculative (close-date) tier read differently: the
          former are settled, the latter prompt review. */}
      {(showDuplicatesNote || showIssuesNote) && (
        <div className="w-fit max-w-full space-y-1.5 rounded-xl border border-border/40 bg-card/30 px-3.5 py-2.5">
          {showDuplicatesNote && (
            <div className="flex items-center gap-2.5 text-sm text-foreground/70">
              <Copy className="h-3.5 w-3.5 text-blue-500 shrink-0" />
              <span>
                {[
                  certainDuplicateCount > 0 &&
                    `${certainDuplicateCount} duplicate${certainDuplicateCount !== 1 ? "s" : ""} detected — already unselected`,
                  possibleDuplicateCount > 0 &&
                    `${possibleDuplicateCount} possible duplicate${possibleDuplicateCount !== 1 ? "s" : ""} (close date match) — review before merging`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
          {showIssuesNote && (
            <div className="flex items-center gap-2.5 text-sm text-foreground/70">
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
        </div>
      )}

      {/* Selection summary + search, directly above the table */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{selectedCount}</span> of{" "}
          <span className="tabular-nums">{totalCount}</span> transactions selected for import
        </p>
        <div className={`relative w-72 max-w-[50%] ${search ? "ring-1 ring-brand/30 rounded-lg" : ""}`}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            placeholder="Search transactions…"
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
          onOpenAccountMapping={() => setShowMappingDialog(true)}
          duplicateIds={duplicateIds}
        />
      </div>

      {/* Floating action bar — always present; Merge gates on selection and
          waits out a run (rows and categories are still settling). */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 backdrop-blur-sm shadow-overlay px-4 py-2.5">
          <div className="flex items-center gap-3 border-r border-border/40 pr-3">
            <span className="text-sm font-medium tabular-nums">{selectedCount} selected</span>
            <span className="text-sm text-muted-foreground tabular-nums font-semibold">
              {format(selectedTotal)}
            </span>
          </div>

          <Button
            size="sm"
            className="gap-1.5"
            disabled={merging || running || selectedCount === 0}
            onClick={() => setShowMergeDialog(true)}
          >
            {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
            {merging ? "Merging…" : "Merge"}
          </Button>
        </div>
      </div>

      {/* Account mapping — opened from the table's ACCOUNT cells. Edits apply
          live, so the table reflects the new targets as they're picked. */}
      {showMappingDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowMappingDialog(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Map accounts</DialogTitle>
              <DialogDescription>
                Where each imported account&rsquo;s transactions land — an existing
                account, or one created on merge.
              </DialogDescription>
            </DialogHeader>
            <ImportMappingRows
              sourceAccounts={sourceAccounts}
              accounts={accounts}
              accountMapping={accountMapping}
              onAccountMappingChange={handleAccountMappingChange}
            />
            <DialogFooter>
              <Button onClick={() => setShowMappingDialog(false)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Merge confirmation — a safety gate. The per-source-account mapping is
          editable here (the same rows the Map-accounts dialog uses), each showing
          its destination's resulting balance, so a wrong mapping is both visible
          and fixable before commit. Unmatched transfers get one warning line
          rather than rows. Header and footer stay pinned; the rows scroll past
          five. */}
      {showMergeDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowMergeDialog(false); }}>
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Merge {selectedCount} transactions?</DialogTitle>
              <DialogDescription>
                This will add{" "}
                <strong>
                  {selectedCount} transaction{selectedCount !== 1 ? "s" : ""}
                </strong>{" "}
                ({format(selectedTotal)}) to your budget.
                {newAccountCount > 0 && (
                  <>
                    {" "}
                    {newAccountCount} new account{newAccountCount > 1 ? "s" : ""} will be created.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            {sourceAccounts.length > 0 && (
              <div className="min-h-0 flex-1 overflow-hidden">
                <ImportMappingRows
                  sourceAccounts={sourceAccounts}
                  accounts={accounts}
                  accountMapping={accountMapping}
                  onAccountMappingChange={handleAccountMappingChange}
                  rowMeta={rowMeta}
                />
              </div>
            )}
            {mergeSummary.unmappedTransferCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-amber-500">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {mergeSummary.unmappedTransferCount === 1
                    ? "1 transfer had no matching counterpart — it’ll import as income/expense."
                    : `${mergeSummary.unmappedTransferCount} transfers had no matching counterpart — they’ll import as income/expense.`}
                </span>
              </div>
            )}
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
