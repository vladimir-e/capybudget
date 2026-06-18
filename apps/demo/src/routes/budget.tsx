import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Navigate, Outlet, redirect } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { RepositoryProvider } from "@/contexts/repository-context";
import { CurrencyProvider } from "@/components/budget/currency-provider";
import { CapySessionProvider } from "@/components/capy/capy-session-provider";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { invalidateAfterCapyMutation } from "@/components/budget/capy-invalidation";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { budgetKeys } from "@/hooks/use-budget-data";
import { createInMemoryRepository } from "@capybudget/persistence";
import { DEFAULT_CURRENCY } from "@capybudget/core";
import { PROFILES } from "../data/profiles";
import { generateScenarioData } from "../data/generator";
import { seedFromString } from "../data/rng";
import { DemoSeedingScreen } from "../components/demo-seeding-screen";
import { hasEnteredScenario } from "../session-entry";

interface BudgetSearch {
  path: string;
  name: string;
}

export const Route = createFileRoute("/budget")({
  validateSearch: (search: Record<string, unknown>): BudgetSearch => ({
    path: (search.path as string) ?? "",
    name: (search.name as string) ?? "",
  }),
  // A hard refresh or deep link resets the module-scoped entry flag, so any
  // arrival at /budget that wasn't reached through the selector this session
  // bounces to scenario selection — never into a freshly-regenerated budget.
  beforeLoad: () => {
    if (!hasEnteredScenario()) {
      throw redirect({ to: "/" });
    }
  },
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
      // Per-scenario seed: a scenario's random texture is identical across
      // visitors and screenshots, and distinct from the other scenarios.
      seed: seedFromString(profile.id),
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
      currency: DEFAULT_CURRENCY,
      onDataChanged,
      repo: repo ?? undefined,
    }),
    [profileId, name, customInstructions.instructions, onDataChanged, repo],
  );

  if (!profile || !repo) {
    return <Navigate to="/" />;
  }

  // profileId stands in for budgetPath: the in-memory budget.json key the
  // Settings currency picker writes through, so a switch reformats demo amounts live.
  return (
    <RepositoryProvider key={profileId} value={repo}>
      <CurrencyProvider budgetPath={profileId}>
        <CapySessionProvider key={profileId} options={sessionOptions}>
          {seeded ? <Outlet /> : <DemoSeedingScreen name={name} onDone={markSeeded} />}
        </CapySessionProvider>
      </CurrencyProvider>
    </RepositoryProvider>
  );
}
