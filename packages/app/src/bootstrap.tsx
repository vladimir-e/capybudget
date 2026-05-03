import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AnyRoute } from "@tanstack/react-router";
import { useIntelligenceStore } from "@/stores/intelligence-store";

export function bootstrapApp(routeTree: AnyRoute) {
  // Fire-and-forget: load persisted IntelligenceConfig (provider, API
  // keys, models) before the user can interact with Capy. On first
  // run with Claude Code installed this auto-defaults provider to
  // "claude-cli" so existing devs see no regression.
  void useIntelligenceStore.getState().hydrate();

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        toast.error("Failed to load data", {
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
  const router = createRouter({ routeTree });

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
