import { createFileRoute } from "@tanstack/react-router";
import { AllAccountsView } from "@/components/budget/all-accounts-view";

export const Route = createFileRoute("/budget/_shell/")({
  component: AllAccountsView,
});
