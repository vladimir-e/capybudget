import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
    ...overrides,
  };
}

function makeStaging(initial: ImportTransaction[]): StagingStore {
  let rows = initial;
  return {
    readTransactions: async () => rows.map((r) => ({ ...r })),
    writeTransactions: async (next: ImportTransaction[]) => {
      rows = next;
    },
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
