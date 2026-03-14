/**
 * Journey test setup.
 *
 * Each journey test file should include this at the top:
 *   import "@/test/journeys/setup";
 *
 * This mock redirects createCsvRepository to return the in-memory
 * test repo set by renderApp(). It is scoped to journey tests only
 * so that unit tests for csv-repository.ts keep testing the real thing.
 */
import { vi } from "vitest";

vi.mock("@capybudget/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capybudget/persistence")>();
  return {
    ...actual,
    createCsvRepository: () => {
      const repo = (globalThis as Record<string, unknown>).__testRepo;
      if (!repo) throw new Error("Test repo not set — call renderApp() first");
      return repo;
    },
  };
});
