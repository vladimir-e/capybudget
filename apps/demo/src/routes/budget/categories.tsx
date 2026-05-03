import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsView } from "@/components/budget/analytics/analytics-view";

export const Route = createFileRoute("/budget/categories")({
  component: AnalyticsView,
});
