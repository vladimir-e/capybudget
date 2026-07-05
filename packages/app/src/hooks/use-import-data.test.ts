import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ImportTransaction } from "@capybudget/core";
import type { StagingStore } from "@capybudget/intelligence";

// The budget-data queries are mutated between renders to simulate accounts
// resolving before categories — the timing the gating fix is about.
const { hookState } = vi.hoisted(() => ({
  hookState: {
    accounts: { data: [] as unknown[] },
    categories: { data: [] as unknown[], isSuccess: false },
  },
}));

vi.mock("@/hooks/use-budget-data", () => ({
  useAccounts: () => hookState.accounts,
  useCategories: () => hookState.categories,
}));

vi.mock("@/hooks/use-import-repository", () => ({
  useImportRepository: () => ({ readAliases: async () => ({ accounts: {} }) }),
}));

import { useImportData } from "./use-import-data";
import { useImportStore } from "@/stores/import-store";

function makeTxn(overrides: Partial<ImportTransaction>): ImportTransaction {
  return {
    id: "imp-1",
    date: "2026-01-05",
    description: "COFFEE",
    amount: -450,
    type: "expense",
    sourceAccount: "",
    sourceCategory: "",
    merchant: "Coffee",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    duplicate: false,
    duplicateConfidence: "",
    ...overrides,
  };
}

function makeStaging(
  initial: ImportTransaction[],
  transferCtxIds: string[] = [],
  dropped: string[] = [],
): StagingStore {
  let rows = initial;
  const transferContext = Object.fromEntries(transferCtxIds.map((id) => [id, {}]));
  return {
    readTransactions: async () => ({
      rows: rows.map((r) => ({ ...r })),
      dropped,
      fixed: [],
    }),
    writeTransactions: async (next: ImportTransaction[]) => {
      rows = next;
    },
    readTransferContext: async () => transferContext,
  } as unknown as StagingStore;
}

describe("useImportData — category validation gating", () => {
  beforeEach(() => {
    hookState.accounts = { data: [{ id: "acc-1", name: "Checking" }] };
    hookState.categories = { data: [], isSuccess: false };
  });

  it("clears a stale category id once categories load — not while only accounts exist", async () => {
    const staging = makeStaging([makeTxn({ categoryId: "ghost-cat", categoryConfidence: "high" })]);

    const { result, rerender } = renderHook(() => useImportData("/b", staging, 0));

    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    // Accounts are loaded but categories aren't — validation must wait, or it
    // would latch and never clear the stale id.
    expect(result.current.transactions[0].categoryId).toBe("ghost-cat");

    // Categories resolve, and the ghost category isn't among them.
    hookState.categories = { data: [{ id: "real-cat" }], isSuccess: true };
    rerender();

    await waitFor(() => expect(result.current.transactions[0].categoryId).toBe(""));
    expect(result.current.transactions[0].categoryConfidence).toBe("");
  });

  it("keeps a category id that is still valid after categories load", async () => {
    const staging = makeStaging([makeTxn({ categoryId: "real-cat", categoryConfidence: "high" })]);

    const { result, rerender } = renderHook(() => useImportData("/b", staging, 0));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    hookState.categories = { data: [{ id: "real-cat" }], isSuccess: true };
    rerender();

    // Give the gated effect a chance to run; the valid id must survive.
    await waitFor(() => expect(result.current.transactions[0].categoryId).toBe("real-cat"));
    expect(result.current.transactions[0].categoryConfidence).toBe("high");
  });
});

describe("useImportData — skipped rows on load", () => {
  beforeEach(() => {
    hookState.accounts = { data: [{ id: "acc-1", name: "Checking" }] };
    hookState.categories = { data: [{ id: "cat-1" }], isSuccess: true };
  });

  it("surfaces the staging read's dropped-row count", async () => {
    const staging = makeStaging([makeTxn({})], [], ["Row 1: bad", "Row 2: bad", "Row 3: bad"]);

    const { result } = renderHook(() => useImportData("/b", staging, 0));

    await waitFor(() => expect(result.current.skippedRowCount).toBe(3));
    expect(result.current.transactions).toHaveLength(1);
  });

  it("reports zero when every staged row survived the read", async () => {
    const staging = makeStaging([makeTxn({})]);

    const { result } = renderHook(() => useImportData("/b", staging, 0));

    await waitFor(() => expect(result.current.transactions).toHaveLength(1));
    expect(result.current.skippedRowCount).toBe(0);
  });
});

describe("useImportData — selection across reloads", () => {
  beforeEach(() => {
    hookState.accounts = { data: [{ id: "acc-1", name: "Checking" }] };
    hookState.categories = { data: [{ id: "cat-1" }], isSuccess: true };
  });

  it("preserves a manual unselect when a landed batch reloads", async () => {
    const staging = makeStaging([
      makeTxn({ id: "imp-1" }),
      makeTxn({ id: "imp-2" }),
    ]);

    const { result, rerender } = renderHook(
      ({ version }: { version: number }) => useImportData("/b", staging, version),
      { initialProps: { version: 0 } },
    );

    // First load selects all non-duplicates.
    await waitFor(() => expect(result.current.selectedIds).toEqual(new Set(["imp-1", "imp-2"])));

    // User unselects a row over the interactive preview.
    act(() => {
      result.current.setSelectedIds(new Set(["imp-1"]));
    });

    // A batch lands → rowsVersion bumps → loadCsv reruns. The unselect must survive.
    rerender({ version: 1 });
    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
    expect(result.current.selectedIds).toEqual(new Set(["imp-1"]));
  });
});

describe("useImportData — write-back teardown guard", () => {
  beforeEach(() => {
    hookState.accounts = { data: [{ id: "acc-1", name: "Checking" }] };
    hookState.categories = { data: [{ id: "cat-1" }], isSuccess: true };
  });

  /** Staging double whose writeTransactions is a spy — a resurrecting write is
   *  exactly the call we must not see after the staging generation is bumped. */
  function makeSpyStaging(initial: ImportTransaction[]) {
    const writeTransactions = vi.fn<(rows: ImportTransaction[]) => Promise<void>>(async () => {});
    const staging = {
      readTransactions: async () => ({ rows: initial.map((r) => ({ ...r })), dropped: [], fixed: [] }),
      writeTransactions,
      readTransferContext: async () => ({}),
    } as unknown as StagingStore;
    return { staging, writeTransactions };
  }

  it("flushes a pending edit to staging while the generation is live", async () => {
    const { staging, writeTransactions } = makeSpyStaging([makeTxn({ id: "imp-1" })]);
    const { result } = renderHook(() => useImportData("/b", staging, 0));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    act(() => result.current.handleUpdate("imp-1", { merchant: "Edited" }));
    await act(async () => {
      await result.current.flushWriteBack();
    });

    expect(writeTransactions).toHaveBeenCalledTimes(1);
    expect(writeTransactions.mock.calls[0][0][0]).toMatchObject({ id: "imp-1", merchant: "Edited" });
  });

  it("no-ops a flush once staging is invalidated (the Cancel/Merge teardown)", async () => {
    const { staging, writeTransactions } = makeSpyStaging([makeTxn({ id: "imp-1" })]);
    const { result } = renderHook(() => useImportData("/b", staging, 0));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    act(() => result.current.handleUpdate("imp-1", { merchant: "Edited" }));
    // Cancel/Merge bump the generation before clearing; the write-back captured
    // the old one at mount, so its flush must not rewrite (and re-mkdir) staging.
    act(() => useImportStore.getState().invalidateStaging());
    await act(async () => {
      await result.current.flushWriteBack();
    });

    expect(writeTransactions).not.toHaveBeenCalled();
  });

  it("discard() drops the pending write without touching staging", async () => {
    const { staging, writeTransactions } = makeSpyStaging([makeTxn({ id: "imp-1" })]);
    const { result } = renderHook(() => useImportData("/b", staging, 0));
    await waitFor(() => expect(result.current.transactions).toHaveLength(1));

    act(() => result.current.handleUpdate("imp-1", { merchant: "Edited" }));
    act(() => result.current.discard());
    await act(async () => {
      await result.current.flushWriteBack();
    });

    expect(writeTransactions).not.toHaveBeenCalled();
  });
});

describe("useImportData — incompleteCount (Enrich gate)", () => {
  beforeEach(() => {
    hookState.accounts = { data: [{ id: "acc-1", name: "Checking" }] };
    hookState.categories = { data: [{ id: "cat-1" }], isSuccess: true };
  });

  const resolved = (id: string): Partial<ImportTransaction> => ({
    id,
    merchant: "Coffee",
    categoryId: "cat-1",
    categoryConfidence: "high",
  });

  it("enables Enrich when a context-bearing transfer lacks a counterpart and all category rows are resolved", async () => {
    const staging = makeStaging(
      [
        makeTxn(resolved("imp-1")),
        makeTxn({ id: "imp-2", type: "transfer", merchant: "", categoryId: "", targetAccountId: "" }),
      ],
      ["imp-2"], // imp-2 carries transfer context
    );

    const { result } = renderHook(() => useImportData("/b", staging, 0));

    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
    expect(result.current.incompleteCount).toBe(1);
  });

  it("does not keep Enrich enabled for a contextless transfer with no counterpart", async () => {
    const staging = makeStaging([
      makeTxn(resolved("imp-1")),
      makeTxn({ id: "imp-2", type: "transfer", merchant: "", categoryId: "", targetAccountId: "" }),
    ]); // no transfer context for imp-2 → can't be auto-resolved

    const { result } = renderHook(() => useImportData("/b", staging, 0));

    await waitFor(() => expect(result.current.transactions).toHaveLength(2));
    expect(result.current.incompleteCount).toBe(0);
  });
});
