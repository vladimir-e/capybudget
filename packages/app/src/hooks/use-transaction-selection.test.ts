import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransactionSelection } from "@/hooks/use-transaction-selection";
import { makeTransaction } from "@/test/factories";
import type { Transaction } from "@capybudget/core";

function makeTxns(ids: string[]): Transaction[] {
  return ids.map((id) => makeTransaction({ id }));
}

describe("useTransactionSelection", () => {
  describe("initial state", () => {
    it("starts with empty selection, allSelected false, indeterminate false", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(false);
    });

    it("handles empty visible transactions", () => {
      const { result } = renderHook(() => useTransactionSelection([]));

      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(false);
    });
  });

  describe("single toggle", () => {
    it("adds a transaction to selectedIds when toggled on", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t2", false));

      expect(result.current.selectedIds.has("t2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });

    it("removes a transaction from selectedIds when toggled off", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t2", false));
      act(() => result.current.toggle("t2", false));

      expect(result.current.selectedIds.has("t2")).toBe(false);
      expect(result.current.selectedIds.size).toBe(0);
    });

    it("can select multiple transactions individually", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));
      act(() => result.current.toggle("t3", false));

      expect(result.current.selectedIds.has("t1")).toBe(true);
      expect(result.current.selectedIds.has("t3")).toBe(true);
      expect(result.current.selectedIds.size).toBe(2);
    });
  });

  describe("toggleAll", () => {
    it("selects all visible when nothing is selected", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggleAll());

      expect(result.current.selectedIds.size).toBe(3);
      expect(result.current.allSelected).toBe(true);
      expect(result.current.indeterminate).toBe(false);
    });

    it("deselects all when everything is selected", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggleAll());
      act(() => result.current.toggleAll());

      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(false);
    });

    it("selects all when only some are selected (partial -> all)", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));
      act(() => result.current.toggleAll());

      expect(result.current.selectedIds.size).toBe(3);
      expect(result.current.allSelected).toBe(true);
    });
  });

  describe("indeterminate state", () => {
    it("is true when some but not all are selected", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));

      expect(result.current.indeterminate).toBe(true);
      expect(result.current.allSelected).toBe(false);
    });

    it("is false when none are selected", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      expect(result.current.indeterminate).toBe(false);
    });

    it("is false when all are selected", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggleAll());

      expect(result.current.indeterminate).toBe(false);
    });
  });

  describe("shift-click range select", () => {
    it("selects a range from last toggled to shift-clicked", () => {
      const txns = makeTxns(["t1", "t2", "t3", "t4", "t5"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));
      act(() => result.current.toggle("t3", true));

      expect(result.current.selectedIds.has("t1")).toBe(true);
      expect(result.current.selectedIds.has("t2")).toBe(true);
      expect(result.current.selectedIds.has("t3")).toBe(true);
      expect(result.current.selectedIds.size).toBe(3);
    });

    it("works in reverse order (shift-click above anchor)", () => {
      const txns = makeTxns(["t1", "t2", "t3", "t4", "t5"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t4", false));
      act(() => result.current.toggle("t2", true));

      expect(result.current.selectedIds.has("t2")).toBe(true);
      expect(result.current.selectedIds.has("t3")).toBe(true);
      expect(result.current.selectedIds.has("t4")).toBe(true);
      expect(result.current.selectedIds.size).toBe(3);
    });

    it("preserves previously selected items outside the range", () => {
      const txns = makeTxns(["t1", "t2", "t3", "t4", "t5"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t5", false)); // select t5
      act(() => result.current.toggle("t1", false)); // select t1, anchor moves to t1
      act(() => result.current.toggle("t3", true));  // range t1..t3

      expect(result.current.selectedIds.has("t1")).toBe(true);
      expect(result.current.selectedIds.has("t2")).toBe(true);
      expect(result.current.selectedIds.has("t3")).toBe(true);
      expect(result.current.selectedIds.has("t5")).toBe(true);
      expect(result.current.selectedIds.size).toBe(4);
    });

    it("falls back to single toggle when no prior anchor exists", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      // Shift-click without prior toggle should act as single toggle
      // because lastToggledRef.current is null
      act(() => result.current.toggle("t2", true));

      expect(result.current.selectedIds.has("t2")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });

    it("falls back to single toggle when anchor is no longer visible", () => {
      const initialTxns = makeTxns(["t1", "t2", "t3"]);
      const { result, rerender } = renderHook(
        ({ txns }) => useTransactionSelection(txns),
        { initialProps: { txns: initialTxns } },
      );

      // Toggle t1 to set as anchor
      act(() => result.current.toggle("t1", false));

      // Change visible transactions, removing t1
      const newTxns = makeTxns(["t2", "t3", "t4"]);
      rerender({ txns: newTxns });

      // Shift-click t3 - anchor t1 is gone, findIndex returns -1
      act(() => result.current.toggle("t3", true));

      // Should fall back to single toggle since anchor is not in visible list
      expect(result.current.selectedIds.has("t3")).toBe(true);
      // t1 stays selected (it was selected before) but t2 should not be range-selected
      expect(result.current.selectedIds.has("t2")).toBe(false);
    });
  });

  describe("clear", () => {
    it("clears all selections", () => {
      const txns = makeTxns(["t1", "t2", "t3"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));
      act(() => result.current.toggle("t2", false));
      act(() => result.current.clear());

      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(false);
    });

    it("resets the anchor so subsequent shift-click acts as single toggle", () => {
      const txns = makeTxns(["t1", "t2", "t3", "t4"]);
      const { result } = renderHook(() => useTransactionSelection(txns));

      act(() => result.current.toggle("t1", false));
      act(() => result.current.clear());

      // Shift-click after clear: no anchor, should be single toggle
      act(() => result.current.toggle("t3", true));

      expect(result.current.selectedIds.has("t3")).toBe(true);
      expect(result.current.selectedIds.size).toBe(1);
    });
  });

  describe("stale IDs with changed visibleTransactions", () => {
    it("computes allSelected correctly when visible transactions shrink", () => {
      const initialTxns = makeTxns(["t1", "t2", "t3"]);
      const { result, rerender } = renderHook(
        ({ txns }) => useTransactionSelection(txns),
        { initialProps: { txns: initialTxns } },
      );

      // Select all three
      act(() => result.current.toggleAll());
      expect(result.current.allSelected).toBe(true);

      // Visible transactions change: only t1 and t2 remain
      const fewerTxns = makeTxns(["t1", "t2"]);
      rerender({ txns: fewerTxns });

      // t1 and t2 are still selected, and those are all visible -> allSelected true
      expect(result.current.allSelected).toBe(true);
      expect(result.current.indeterminate).toBe(false);
    });

    it("computes indeterminate correctly when visible transactions grow", () => {
      const initialTxns = makeTxns(["t1", "t2"]);
      const { result, rerender } = renderHook(
        ({ txns }) => useTransactionSelection(txns),
        { initialProps: { txns: initialTxns } },
      );

      // Select all two
      act(() => result.current.toggleAll());
      expect(result.current.allSelected).toBe(true);

      // Visible transactions grow: t3 is added
      const moreTxns = makeTxns(["t1", "t2", "t3"]);
      rerender({ txns: moreTxns });

      // t1 and t2 selected, but t3 is not -> indeterminate
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(true);
    });

    it("computes correctly when all selected IDs are no longer visible", () => {
      const initialTxns = makeTxns(["t1", "t2"]);
      const { result, rerender } = renderHook(
        ({ txns }) => useTransactionSelection(txns),
        { initialProps: { txns: initialTxns } },
      );

      act(() => result.current.toggleAll());

      // Completely different set of visible transactions
      const newTxns = makeTxns(["t3", "t4"]);
      rerender({ txns: newTxns });

      // None of the visible transactions are selected
      expect(result.current.allSelected).toBe(false);
      expect(result.current.indeterminate).toBe(false);
    });
  });
});
