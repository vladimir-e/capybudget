import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CapySessionProvider } from "@/components/capy/capy-session-provider";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { invalidateAfterCapyMutation } from "@/components/budget/capy-invalidation";
import { useIntelligenceStore } from "@/stores/intelligence-store";
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

// Demo mirror of the desktop budget layout (session adapter is a stub via vite alias).
function DemoBudgetLayout() {
  const { path: profileId, name } = Route.useSearch();
  const profile = PROFILES[profileId];
  const queryClient = useQueryClient();

  // Play the seeding beat once per scenario entry. The flag lives in this
  // persistent layout, so visiting Settings (a sibling of `_shell`) doesn't
  // remount it and replay the animation. Reset on scenario change during
  // render to avoid a flash of the previous scenario's shell.
  const [seeded, setSeeded] = useState(false);
  const markSeeded = useCallback(() => setSeeded(true), []);
  const [seededFor, setSeededFor] = useState(profileId);
  if (seededFor !== profileId) {
    setSeededFor(profileId);
    setSeeded(false);
  }

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

  const provider = useIntelligenceStore((s) => s.config.provider);
  const customInstructions = useCustomInstructions(profileId);

  const onDataChanged = useCallback(() => {
    if (!repo) return;
    invalidateAfterCapyMutation({
      provider,
      repo,
      invalidateQueries: () => queryClient.invalidateQueries({ queryKey: budgetKeys.all }),
    });
  }, [queryClient, repo, provider]);

  const sessionOptions = useMemo(
    () => ({
      budgetPath: profileId,
      budgetName: name,
      mcpServerPath: "packages/mcp/src/server.ts",
      customInstructions: customInstructions.instructions,
      onDataChanged,
      repo: repo ?? undefined,
    }),
    [profileId, name, customInstructions.instructions, onDataChanged, repo],
  );

  if (!profile || !repo) {
    return <Navigate to="/" />;
  }

  return (
    <RepositoryProvider key={profileId} value={repo}>
      <CapySessionProvider key={profileId} options={sessionOptions}>
        {seeded ? <Outlet /> : <DemoSeedingScreen name={name} onDone={markSeeded} />}
      </CapySessionProvider>
    </RepositoryProvider>
  );
}
