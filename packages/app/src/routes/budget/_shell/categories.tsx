import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsView } from "@/components/budget/analytics/analytics-view";
import { TAB_IDS, type TabId } from "@/stores/analytics-store";

export const Route = createFileRoute("/budget/_shell/categories")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } =>
    TAB_IDS.includes(search.tab as TabId) ? { tab: search.tab as TabId } : {},
  component: AnalyticsView,
});
