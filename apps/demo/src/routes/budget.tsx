import { useEffect, useMemo } from "react";
import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { createInMemoryRepository } from "@capybudget/persistence";
import { PROFILES } from "../data/profiles";
import { generateScenarioData } from "../data/generator";

interface BudgetSearch {
  path: string;
  name: string;
}

/** Stable per-scenario seed so a scenario's random texture is identical across
 *  visitors and screenshots; dates still track today. Derived from the profile
 *  id (FNV-1a) so the three scenarios stay distinct from one another. */
function seedFor(profileId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i++) {
    hash ^= profileId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "",
  }),
  component: DemoBudgetLayout,
});

/**
 * Repo-owning layout for the demo budget subtree. The in-memory repo is created
 * once per scenario and disposed only when leaving the budget — navigating
 * between the chrome (`_shell`) and settings keeps it (and its edits) alive.
 *
 * Seam for Unit 3: a persistent Capy session provider slots in here around the
 * Outlet, mirroring the desktop layout.
 */
function DemoBudgetLayout() {
  const { path: profileId } = Route.useSearch();
  const profile = PROFILES[profileId];
  const queryClient = useQueryClient();

  // One repo per scenario entry: in-app navigation and edits survive, only a
  // hard reload regenerates. This ephemerality is the "safe to mess around"
  // behavior — no persistence by design.
  const repo = useMemo(() => {
    if (!profile) return null;
    const data = generateScenarioData(profile, {
      now: new Date(),
      yearsBack: 3,
      seed: seedFor(profile.id),
    });
    return createInMemoryRepository(data);
  }, [profile]);

  useEffect(() => {
    return () => {
      void repo?.dispose();
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  if (!profile || !repo) {
    return <Navigate to="/" />;
  }

  return (
    <RepositoryProvider key={profileId} value={repo}>
      <Outlet />
    </RepositoryProvider>
  );
}
