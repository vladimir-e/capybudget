import React from "react";
import { render, cleanup, type RenderResult } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach } from "vitest";
import { routeTree } from "../../../../src/routeTree.gen";
import { createInMemoryRepository, type InMemoryRepository, type MemoryRepositoryData } from "@capybudget/persistence";
import { useUndoStore } from "@/stores/undo-store";

export interface RenderAppOptions {
  /** Seed data for the in-memory repository. */
  seed?: MemoryRepositoryData;
  /** Initial URL (defaults to the "All Accounts" budget view). */
  url?: string;
}

export interface RenderAppResult extends RenderResult {
  user: UserEvent;
  repo: InMemoryRepository;
  queryClient: QueryClient;
}

// Track the active QueryClient so we can tear it down between tests.
let activeQueryClient: QueryClient | null = null;

afterEach(async () => {
  // Unmount React tree first, then cancel any in-flight queries/mutations.
  cleanup();
  if (activeQueryClient) {
    await activeQueryClient.cancelQueries();
    activeQueryClient.clear();
    activeQueryClient = null;
  }
  useUndoStore.getState().reset();
  delete (globalThis as Record<string, unknown>).__testRepo;
});

/**
 * Mount the full app with an in-memory repository and memory router.
 *
 * The CSV persistence layer is completely bypassed — reads and writes
 * go to plain arrays. No Tauri APIs are touched.
 */
export async function renderApp(options: RenderAppOptions = {}): Promise<RenderAppResult> {
  const {
    seed = {},
    url = "/budget?path=/test-budget&name=Test+Budget",
  } = options;

  const repo = createInMemoryRepository(seed);

  // Inject repo so the mocked createCsvRepository returns it (see journeys/setup.ts)
  (globalThis as Record<string, unknown>).__testRepo = repo;

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  activeQueryClient = queryClient;

  const history = createMemoryHistory({ initialEntries: [url] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = createRouter({ routeTree, history } as any);

  // Preload route components before rendering (code-split chunks are async)
  await router.load();

  const result = render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );

  return {
    ...result,
    user: userEvent.setup(),
    repo,
    queryClient,
  };
}
