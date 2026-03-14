import { useCallback, useRef, useState } from "react";
import type { Transaction } from "@capybudget/core";

export interface TransactionSelection {
  selectedIds: Set<string>;
  /** Toggle a single transaction. If shift is held, range-select from last toggled. */
  toggle: (txnId: string, shiftKey: boolean) => void;
  /** Select or deselect all visible transactions. */
  toggleAll: () => void;
  /** Clear the entire selection. */
  clear: () => void;
  /** Whether all visible transactions are selected. */
  allSelected: boolean;
  /** Whether some but not all visible transactions are selected. */
  indeterminate: boolean;
}

export function useTransactionSelection(
  visibleTransactions: Transaction[],
): TransactionSelection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastToggledRef = useRef<string | null>(null);

  const toggle = useCallback(
    (txnId: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastToggledRef.current) {
          // Range select: find indices of last toggled and current
          const lastIdx = visibleTransactions.findIndex(
            (t) => t.id === lastToggledRef.current,
          );
          const currentIdx = visibleTransactions.findIndex(
            (t) => t.id === txnId,
          );

          if (lastIdx !== -1 && currentIdx !== -1) {
            const start = Math.min(lastIdx, currentIdx);
            const end = Math.max(lastIdx, currentIdx);
            for (let i = start; i <= end; i++) {
              next.add(visibleTransactions[i].id);
            }
            lastToggledRef.current = txnId;
            return next;
          }
        }

        // Single toggle
        if (next.has(txnId)) {
          next.delete(txnId);
        } else {
          next.add(txnId);
        }
        lastToggledRef.current = txnId;
        return next;
      });
    },
    [visibleTransactions],
  );

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const visibleIds = visibleTransactions.map((t) => t.id);
      const allSelected = visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        return new Set<string>();
      }
      return new Set(visibleIds);
    });
  }, [visibleTransactions]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    lastToggledRef.current = null;
  }, []);

  const visibleIds = visibleTransactions.map((t) => t.id);
  const selectedCount = visibleIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
  const indeterminate = selectedCount > 0 && !allSelected;

  return { selectedIds, toggle, toggleAll, clear, allSelected, indeterminate };
}
