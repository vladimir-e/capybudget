import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AnyRoute } from "@tanstack/react-router";
import { i18n } from "@capybudget/i18n";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorScreen } from "@/components/error-screen";
import { useIntelligenceStore } from "@/stores/intelligence-store";

export async function bootstrapApp(routeTree: AnyRoute) {
  // Awaited: load persisted IntelligenceConfig (provider, API keys,
  // models) before the first paint. On first run with Claude Code
  // installed this auto-defaults provider to "claude-cli" so existing
  // devs see no regression. Awaiting avoids a flash of the
  // "Set up your AI assistant" empty state during the disk read; the
  // read is local and fast (~ms) so the cost is invisible.
  await useIntelligenceStore.getState().hydrate();

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        toast.error(i18n.t("common:errors.loadFailed"), {
          description: error.message,
        });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  });
  // TanStack Router catches a route component's render error in its own
  // per-route CatchBoundary before it can reach the top-level ErrorBoundary,
  // so route crashes route through our screen here; the boundary nets only
  // what escapes the router (provider/bootstrap errors).
  const router = createRouter({
    routeTree,
    defaultErrorComponent: ({ error, info }) => (
      <ErrorScreen error={error} componentStack={info?.componentStack} />
    ),
  });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
