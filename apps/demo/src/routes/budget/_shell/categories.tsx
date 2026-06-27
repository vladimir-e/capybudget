import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsView } from "@/components/budget/analytics/analytics-view";
import { validateTabSearch } from "@/stores/analytics-store";

export const Route = createFileRoute("/budget/_shell/categories")({
  validateSearch: validateTabSearch,
  component: AnalyticsView,
});
