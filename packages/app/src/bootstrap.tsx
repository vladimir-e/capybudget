import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AnyRoute } from "@tanstack/react-router";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { checkForUpdates } from "@/lib/updater";

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

  // Only run inside the Tauri shell — the updater plugin throws in a
  // plain browser context. Deferred so first paint isn't blocked by a
  // network round-trip to GitHub.
  if ("__TAURI_INTERNALS__" in window) {
    setTimeout(() => {
      void checkForUpdates();
    }, 1500);
  }
}
