import { createFileRoute } from "@tanstack/react-router";
import { DemoBudgetSelector } from "../components/demo-budget-selector";

export const Route = createFileRoute("/")({
  component: DemoBudgetSelector,
});
