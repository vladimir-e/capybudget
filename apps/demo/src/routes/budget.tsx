import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BudgetShell } from "@/components/budget/budget-shell";
import { RepositoryProvider } from "@/contexts/repository-context";
import { budgetKeys } from "@/hooks/use-budget-data";
import { createInMemoryRepository } from "@capybudget/persistence";
import { PROFILES } from "../data/profiles";
import { generateScenarioData } from "../data/generator";
import { DemoSeedingScreen } from "../components/demo-seeding-screen";

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

function DemoBudgetLayout() {
  const { path: profileId, name } = Route.useSearch();
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

  const [seeded, setSeeded] = useState(false);
  const markSeeded = useCallback(() => setSeeded(true), []);

  // Replay the seeding beat whenever the scenario changes, even if the layout
  // re-renders without remounting (e.g. /budget?path=X → ?path=Y). Reset during
  // render rather than in an effect to avoid a flash of the previous shell.
  const [seededFor, setSeededFor] = useState(profileId);
  if (seededFor !== profileId) {
    setSeededFor(profileId);
    setSeeded(false);
  }

  useEffect(() => {
    return () => {
      void repo?.dispose();
      queryClient.removeQueries({ queryKey: budgetKeys.all });
    };
  }, [repo, queryClient]);

  if (!profile || !repo) {
    return <Navigate to="/" />;
  }

  if (!seeded) {
    return <DemoSeedingScreen name={name} onDone={markSeeded} />;
  }

  return (
    <RepositoryProvider key={profileId} value={repo}>
      <BudgetShell path={profileId} name={name} />
    </RepositoryProvider>
  );
}
