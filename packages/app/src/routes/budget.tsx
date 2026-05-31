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

/**
 * Repo- and session-owning layout for the whole budget subtree. Both the
 * repository and the Capy session are created once per budget path and disposed
 * only when this layout unmounts — i.e. when leaving the budget or switching
 * budgets. Navigating between the chrome tabs (`_shell`) and full-screen settings
 * keeps this layout mounted, so the repo, its TanStack Query cache, and the chat
 * conversation all survive the round-trip.
 */
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
    <RepositoryProvider value={repo}>
      <CapySessionProvider options={sessionOptions}>
        <Outlet />
      </CapySessionProvider>
    </RepositoryProvider>
  );
}
