import { createFileRoute } from "@tanstack/react-router";
import { BudgetShell } from "@/components/budget/budget-shell";

export const Route = createFileRoute("/budget/_shell")({
  component: BudgetShell,
});
