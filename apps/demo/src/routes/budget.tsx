import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/providers/repository-provider";
import { createInMemoryRepository } from "../adapters/in-memory-repository";
import { DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSACTIONS } from "../data/demo-budget";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "demo",
    name: (search.name as string) ?? "Demo Budget",
  }),
  component: DemoBudgetLayout,
});

function DemoBudgetLayout() {
  const { path, name } = Route.useSearch();
  const repo = useMemo(
    () => createInMemoryRepository(DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSACTIONS),
    [],
  );

  return (
    <RepositoryProvider value={repo}>
      <BudgetShell path={path} name={name} />
    </RepositoryProvider>
  );
}
