import { useEffect, useMemo } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/providers/repository-provider";
import { budgetKeys } from "@/hooks/use-budget-data";
import { createInMemoryRepository } from "@capybudget/persistence";
import { PRESETS } from "../data/presets";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "",
  }),
  component: DemoBudgetLayout,
});

function DemoBudgetLayout() {
  const { path: presetId, name } = Route.useSearch();
  const preset = PRESETS[presetId];
  const queryClient = useQueryClient();

  const repo = useMemo(() => {
    if (!preset) return null;
    return createInMemoryRepository(preset);
  }, [preset]);

  useEffect(() => {
    return () => {
      void repo?.dispose();
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  if (!preset || !repo) {
    return <Navigate to="/" />;
  }

  return (
    <RepositoryProvider key={presetId} value={repo}>
      <BudgetShell path={`/home/${presetId}`} name={name} />
    </RepositoryProvider>
  );
}
