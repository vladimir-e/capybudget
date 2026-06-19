import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const journeyGlob = "packages/app/src/test/journeys/**/*.test.{ts,tsx}";

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
          exclude: [...configDefaults.exclude, "apps/demo/**", journeyGlob],
        },
      },
      {
        extends: true,
        // The journeys load the full app module graph per file (~5.6s cold
        // start each). A shared-module worker pool halves that transform cost.
        // isolate:false leaks module state across files, which is fine here —
        // every journey resets stores via renderApp — but would corrupt the
        // unit suite, so it stays scoped to this project.
        test: {
          name: "journeys",
          include: [journeyGlob],
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
