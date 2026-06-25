import { createFileRoute } from "@tanstack/react-router";
import { BudgetSelector } from "@/components/budget/budget-selector";
import { resolveLaunchRedirect } from "./-launch-budget";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const target = await resolveLaunchRedirect();
    if (target) throw target;
  },
  component: BudgetSelector,
});
