import { createFileRoute } from "@tanstack/react-router";
import { BudgetSelector } from "@/components/budget/budget-selector";

export const Route = createFileRoute("/")({
  component: BudgetSelector,
});
