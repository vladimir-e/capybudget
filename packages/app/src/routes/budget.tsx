import { useEffect, useMemo } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { createCsvRepository } from "@capybudget/persistence";
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
 * Repo-owning layout for the whole budget subtree. The repository is created
 * once per budget path and disposed only when this layout unmounts — i.e. when
 * leaving the budget entirely. Navigating between the chrome tabs (`_shell`) and
 * full-screen settings keeps this layout mounted, so the repo (and its TanStack
 * Query cache) survives the round-trip.
 *
 * Seam for Unit 3: the persistent Capy session provider slots in here, wrapping
 * the Outlet so the chat outlives a visit to settings the same way the repo does.
 */
function BudgetLayout() {
  const { path } = Route.useSearch();
  const queryClient = useQueryClient();
  const repo = useMemo(() => createCsvRepository(path, tauriFileAdapter), [path]);

  useEffect(() => {
    return () => {
      void repo.dispose().catch((err) => console.error("Failed to dispose repository", err));
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  return (
    <RepositoryProvider value={repo}>
      <Outlet />
    </RepositoryProvider>
  );
}
