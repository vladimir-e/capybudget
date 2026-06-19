import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Full-app-mount tests: each renders the entire app via renderApp(), paying a
// ~5.6s module-graph cold start. Partition is by cost-class, not directory —
// these live both in journeys/ and beside the components they exercise.
//
// Eligibility is stricter than "renders the full app": because this pool runs
// isolate:false (shared module registry across files in a worker), a file here
// must NOT vi.mock a module that another file in the pool uses for real. That
// rules out budget-selector.test.tsx — it module-mocks src/services/budget,
// which the journey tests exercise live; sharing a registry would feed them the
// mock and they'd never render. It stays in the isolated `unit` pool.
const fullAppMountTests = [
  "packages/app/src/test/journeys/**/*.test.{ts,tsx}",
  "packages/app/src/components/budget/first-run-guide.test.tsx",
  "packages/app/src/test/performance.test.tsx",
];

export default defineConfig(async () => ({
  define: {
    __PROJECT_ROOT__: JSON.stringify(process.cwd()),
    __IS_DEMO__: JSON.stringify(false),
  },
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./packages/app/src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      "@demo": path.resolve(__dirname, "./apps/demo/src"),
      "@": path.resolve(__dirname, "./packages/app/src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./packages/app/src/test/setup.ts"],
    // Demo specs run under apps/demo's own config (npm run test:demo) so they
    // see __IS_DEMO__ = true and the Tauri stubs. Keep them out of this run.
    exclude: [...configDefaults.exclude, "apps/demo/**"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...configDefaults.exclude, "apps/demo/**", ...fullAppMountTests],
        },
      },
      {
        extends: true,
        // Full-app-mount tests each transform/import the whole app module graph
        // (~5.6s cold start per file). A shared-module worker pool pays that
        // cost once per worker instead of once per file. isolate:false leaks
        // module state across files, which is fine here — every file resets its
        // own state per test (renderApp's afterEach, or beforeEach mock/store
        // resets) — but would corrupt the unit suite, so it stays scoped here.
        test: {
          name: "full-app",
          include: [...fullAppMountTests],
          pool: "threads",
          isolate: false,
        },
      },
    ],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
