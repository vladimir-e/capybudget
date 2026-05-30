/**
 * Regression test for the silent-data-loss bug in OpenAI/Anthropic
 * mutation turns.
 *
 * Before: `budget-shell` unconditionally called `repo.invalidateCache()`
 * on every Capy mutation. For in-process API adapters (which share the
 * UI's repo), the cache-clear raced the debounced CSV writer — a turn
 * with N sequential mutations persisted only the last one because each
 * subsequent `getTransactions()` re-read stale disk state.
 *
 * Contract this test pins down:
 *   - `claude-cli`  → invalidate (MCP runs in a separate process)
 *   - `anthropic`   → DO NOT invalidate (shared repo, debounced writer)
 *   - `openai`      → DO NOT invalidate (shared repo, debounced writer)
 *   - `null`        → no-op on the cache (nothing's mutating anyway)
 *   - React-Query always re-fetches — that path reads from the shared
 *     in-memory cache, so it's correct in both transports.
 */
import { describe, it, expect, vi } from "vitest";
import type { DisposableRepository } from "@capybudget/persistence";
import {
  invalidateAfterCapyMutation,
  shouldDropRepoCache,
} from "./capy-invalidation";

function makeRepo(): DisposableRepository {
  return {
    getAccounts: vi.fn().mockResolvedValue([]),
    getCategories: vi.fn().mockResolvedValue([]),
    getTransactions: vi.fn().mockResolvedValue([]),
    getBudgetMeta: vi.fn().mockResolvedValue({
      schemaVersion: 3,
      name: "Test Budget",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
      basis: "trailing3",
    }),
    saveAccounts: vi.fn().mockResolvedValue(undefined),
    saveCategories: vi.fn().mockResolvedValue(undefined),
    saveTransactions: vi.fn().mockResolvedValue(undefined),
    saveBudgetMeta: vi.fn().mockResolvedValue(undefined),
    invalidateCache: vi.fn<() => void>(),
    dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe("shouldDropRepoCache", () => {
  it("returns true only for claude-cli", () => {
    expect(shouldDropRepoCache("claude-cli")).toBe(true);
    expect(shouldDropRepoCache("anthropic")).toBe(false);
    expect(shouldDropRepoCache("openai")).toBe(false);
    expect(shouldDropRepoCache(null)).toBe(false);
  });
});

describe("invalidateAfterCapyMutation", () => {
  it("drops the in-memory cache for claude-cli (separate-process MCP)", () => {
    const repo = makeRepo();
    const invalidateQueries = vi.fn();

    invalidateAfterCapyMutation({ provider: "claude-cli", repo, invalidateQueries });

    expect(repo.invalidateCache).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("does NOT drop the cache for openai (shared repo + debounced writer)", () => {
    const repo = makeRepo();
    const invalidateQueries = vi.fn();

    invalidateAfterCapyMutation({ provider: "openai", repo, invalidateQueries });

    // Critical: clearing the cache here would discard the in-memory
    // truth before the debounced CSV write fired, losing the mutation.
    expect(repo.invalidateCache).not.toHaveBeenCalled();
    // React Query still re-fetches — reads through the shared cache.
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("does NOT drop the cache for anthropic (same reason as openai)", () => {
    const repo = makeRepo();
    const invalidateQueries = vi.fn();

    invalidateAfterCapyMutation({ provider: "anthropic", repo, invalidateQueries });

    expect(repo.invalidateCache).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("re-fetches but skips the cache drop when no provider is configured", () => {
    const repo = makeRepo();
    const invalidateQueries = vi.fn();

    invalidateAfterCapyMutation({ provider: null, repo, invalidateQueries });

    expect(repo.invalidateCache).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
  });

  it("regression: 4 sequential mutation acks never invalidate the cache on openai", () => {
    // Mirrors the failing scenario: a single turn with four sequential
    // create_transaction calls. Each tool-result fires onDataChanged,
    // which calls this helper. The cache must survive all four so the
    // debounced writer can flush the final state to disk.
    const repo = makeRepo();
    const invalidateQueries = vi.fn();

    for (let i = 0; i < 4; i++) {
      invalidateAfterCapyMutation({ provider: "openai", repo, invalidateQueries });
    }

    expect(repo.invalidateCache).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });
});
