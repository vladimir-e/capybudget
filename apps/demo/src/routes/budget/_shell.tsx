import { useCallback, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BudgetShell } from "@/components/budget/budget-shell";
import { DemoSeedingScreen } from "../../components/demo-seeding-screen";

export const Route = createFileRoute("/budget/_shell")({
  component: DemoBudgetShell,
});

function DemoBudgetShell() {
  const { path: profileId, name } = Route.useSearch();
  const [seeded, setSeeded] = useState(false);
  const markSeeded = useCallback(() => setSeeded(true), []);

  // Replay the seeding beat whenever the scenario changes, even if this layout
  // re-renders without remounting (e.g. /budget?path=X → ?path=Y). Reset during
  // render rather than in an effect to avoid a flash of the previous shell.
  const [seededFor, setSeededFor] = useState(profileId);
  if (seededFor !== profileId) {
    setSeededFor(profileId);
    setSeeded(false);
  }

  if (!seeded) {
    return <DemoSeedingScreen name={name} onDone={markSeeded} />;
  }

  return <BudgetShell />;
}
