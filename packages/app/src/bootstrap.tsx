import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import type { AnyRoute } from "@tanstack/react-router";
import { i18n } from "@capybudget/i18n";
import { ErrorBoundary } from "@/components/error-boundary";
import { ErrorScreen } from "@/components/error-screen";
import { setCrashComponentStack } from "@/lib/crash-recovery";
import { reconcileFolderAccess } from "@/lib/folder-access";
import { useIntelligenceStore } from "@/stores/intelligence-store";

export async function bootstrapApp(routeTree: AnyRoute) {
  // Awaited: load the plaintext IntelligenceConfig (provider, models, and
  // per-provider key-presence flags) before the first paint. This never reads
  // the OS keychain — secrets load on demand later — so boot pops no credential
  // prompt. Awaiting avoids a flash of the "Set up your AI assistant" empty
  // state during the disk read; the read is local and fast (~ms).
  await useIntelligenceStore.getState().hydrate();

  // Fire-and-forget: prune bookmarks for folders no longer in recents. Cleans
  // debris left by evictions/crashes without delaying first paint.
  void reconcileFolderAccess();

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
  // per-route CatchBoundary before it can reach the top-level ErrorBoundary, so
  // route crashes render ErrorScreen here; the boundary nets only what escapes
  // the router (provider/bootstrap errors). The catch boundary passes just
  // { error } to the component — the component stack arrives via onCatch.
  const router = createRouter({
    routeTree,
    defaultErrorComponent: ({ error }) => <ErrorScreen error={error} />,
    defaultOnCatch: (error, errorInfo) => {
      console.error(error, errorInfo.componentStack);
      setCrashComponentStack(errorInfo.componentStack);
    },
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
