import { useEffect, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/repositories";
import { createCsvRepository } from "@/repositories";

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
  const repo = useMemo(() => createCsvRepository(path), [path]);

  useEffect(() => {
    return () => {
      repo.dispose();
    };
  }, [repo]);

  return (
    <RepositoryProvider value={repo}>
      <BudgetShell path={path} name={name} />
    </RepositoryProvider>
  );
}
