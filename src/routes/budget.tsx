import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/repositories";
import { createCsvRepository } from "@/repositories";
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

function BudgetLayout() {
  const { path, name } = Route.useSearch();
  const queryClient = useQueryClient();
  const repo = useMemo(() => createCsvRepository(path), [path]);

  useEffect(() => {
    return () => {
      void repo.dispose().catch((err) => console.error("Failed to dispose repository", err));
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  return (
    <RepositoryProvider value={repo}>
      <BudgetShell path={path} name={name} />
    </RepositoryProvider>
  );
}
