import { useMemo, useRef } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/providers/repository-provider";
import { createInMemoryRepository } from "../adapters/in-memory-repository";
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
  const prevPresetRef = useRef<string | null>(null);

  // Clear stale budget data when switching presets
  if (prevPresetRef.current !== presetId) {
    prevPresetRef.current = presetId;
    queryClient.removeQueries({ queryKey: ["budget"] });
  }

  const repo = useMemo(() => {
    if (!preset) return null;
    return createInMemoryRepository(preset.accounts, preset.categories, preset.transactions);
  }, [preset]);

  if (!preset || !repo) {
    return <Navigate to="/" />;
  }

  return (
    <RepositoryProvider key={presetId} value={repo}>
      <BudgetShell path={`/home/${presetId}`} name={name} />
    </RepositoryProvider>
  );
}
