import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

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
