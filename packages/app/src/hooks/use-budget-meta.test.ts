/**
 * `useBudgetMeta.setCurrency` must do a full read-modify-write: persist the
 * new currency + a refreshed `lastModified` while preserving name,
 * schemaVersion, and createdAt. The shared `budget.json` cache key carries the
 * whole `BudgetMeta`, so a currency-only write would clobber the rest.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useBudgetMeta } from "./use-budget-meta";

const mockReadTextFile = vi.mocked(readTextFile);
const mockWriteTextFile = vi.mocked(writeTextFile);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

const STORED_META = {
  schemaVersion: 3,
  name: "My Budget",
  currency: "USD",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastModified: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteTextFile.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useBudgetMeta", () => {
  it("setCurrency preserves name/schemaVersion/createdAt and updates currency + lastModified", async () => {
    mockReadTextFile.mockResolvedValue(JSON.stringify(STORED_META));

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    // Wait for the stored meta to load — currency "USD" also matches the
    // default, so key on `name` to know the real file resolved.
    await waitFor(() => expect(result.current.data.name).toBe("My Budget"));

    await act(async () => {
      await result.current.setCurrency("EUR");
    });

    expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
    const [path, contents] = mockWriteTextFile.mock.calls[0] as [string, string];
    expect(path).toBe("/b/budget.json");

    const written = JSON.parse(contents);
    expect(written.currency).toBe("EUR");
    expect(written.name).toBe("My Budget");
    expect(written.schemaVersion).toBe(3);
    expect(written.createdAt).toBe("2026-01-01T00:00:00.000Z");
    // lastModified refreshes on write.
    expect(written.lastModified).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back to USD for a pre-currency budget.json without crashing", async () => {
    mockReadTextFile.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 2,
        name: "Legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastModified: "2026-01-01T00:00:00.000Z",
      }),
    );

    const { result } = renderHook(() => useBudgetMeta("/b"), { wrapper });
    await waitFor(() => expect(result.current.data.name).toBe("Legacy"));
    expect(result.current.data.currency).toBe("USD");
  });
});
