import { useCallback, useEffect, useMemo } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CapySessionProvider } from "@/components/capy/capy-session-provider";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { invalidateAfterCapyMutation } from "@/components/budget/capy-invalidation";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { createCsvRepository } from "@capybudget/persistence";
import type { DisposableRepository } from "@capybudget/persistence";
import { tauriFileAdapter } from "../../../../src/adapters/tauri-file-adapter";
import { budgetKeys } from "@/hooks/use-budget-data";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "Budget",
  }),
  component: BudgetLayout,
});

// Owns the repo and Capy session for the budget subtree: created once per
// budget path, disposed only on unmount. Stays mounted across the chrome↔
// settings swap, so repo, query cache, and chat survive the round-trip.
function BudgetLayout() {
  const { path, name } = Route.useSearch();
  const queryClient = useQueryClient();
  const repo = useMemo(() => createCsvRepository(path, tauriFileAdapter), [path]);

  useEffect(() => {
    return () => {
      void repo.dispose().catch((err) => console.error("Failed to dispose repository", err));
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  const provider = useIntelligenceStore((s) => s.config.provider);
  const customInstructions = useCustomInstructions(path);

  const onDataChanged = useCallback(() => {
    invalidateAfterCapyMutation({
      provider,
      repo: repo as DisposableRepository,
      invalidateQueries: () => queryClient.invalidateQueries({ queryKey: budgetKeys.all }),
    });
  }, [queryClient, repo, provider]);

  const sessionOptions = useMemo(
    () => ({
      budgetPath: path,
      budgetName: name,
      mcpServerPath: "packages/mcp/src/server.ts",
      customInstructions: customInstructions.instructions,
      onDataChanged,
      repo,
      fileAdapter: tauriFileAdapter,
    }),
    [path, name, customInstructions.instructions, onDataChanged, repo],
  );

  return (
    <RepositoryProvider key={path} value={repo}>
      <CapySessionProvider key={path} options={sessionOptions}>
        <Outlet />
      </CapySessionProvider>
    </RepositoryProvider>
  );
}
