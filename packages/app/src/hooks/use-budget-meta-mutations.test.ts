import { describe, it, expect } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInMemoryRepository, type InMemoryRepository } from "@capybudget/persistence";
import type { BudgetMeta } from "@capybudget/core";
import { RepositoryProvider } from "@/providers/repository-provider";
import { budgetKeys, useBudgetMeta } from "@/hooks/use-budget-data";
import { useUndoStore } from "@/stores/undo-store";
import { useSetBudgetBasis } from "@/hooks/use-budget-meta-mutations";

function setup(seedMeta?: Partial<BudgetMeta>) {
  const repo: InMemoryRepository = createInMemoryRepository({
    meta: seedMeta
      ? {
          schemaVersion: 3,
          name: "Seed",
          currency: "USD",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastModified: "2026-01-01T00:00:00.000Z",
          basis: "trailing3",
          ...seedMeta,
        }
      : undefined,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RepositoryProvider, { value: repo }, children),
    );
  return { repo, queryClient, wrapper };
}

describe("useSetBudgetBasis", () => {
  it("sets the basis, persists it, and updates the meta query cache", async () => {
    const { repo, queryClient, wrapper } = setup({ name: "My Budget", basis: "trailing3" });

    // Load meta into the cache (the mutation reads current meta from there).
    const read = renderHook(() => useBudgetMeta(), { wrapper });
    await waitFor(() => expect(read.result.current.data?.basis).toBe("trailing3"));

    const { result } = renderHook(() => useSetBudgetBasis(), { wrapper });
    await result.current.mutateAsync("trailing12");

    // Persisted to the repo, other fields intact.
    expect(repo.data.meta.basis).toBe("trailing12");
    expect(repo.data.meta.name).toBe("My Budget");
    expect(repo.data.meta.schemaVersion).toBe(3);

    // Cache reflects the new basis.
    const cached = queryClient.getQueryData<BudgetMeta>(budgetKeys.meta());
    expect(cached?.basis).toBe("trailing12");
  });

  it("does not push an undo snapshot (settings aren't undoable)", async () => {
    useUndoStore.getState().reset();
    const { wrapper } = setup({ basis: "trailing3" });

    const read = renderHook(() => useBudgetMeta(), { wrapper });
    await waitFor(() => expect(read.result.current.data).toBeDefined());

    const { result } = renderHook(() => useSetBudgetBasis(), { wrapper });
    await result.current.mutateAsync("trailing6");

    // `present` stays null only if pushSnapshot was never called — a sharper
    // signal than `canUndo`, which is false after a single capture anyway.
    expect(useUndoStore.getState().present).toBeNull();
  });
});
