import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
  base: process.env.DEMO_BASE_PATH ?? "/",
  define: {
    __PROJECT_ROOT__: JSON.stringify(""),
    __IS_DEMO__: JSON.stringify(true),
    __MAS__: JSON.stringify(false),
  },
  plugins: [
    TanStackRouterVite({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: [
      // Override the Claude CLI session with the demo stub (must
      // precede the @/ catch-all). The shim re-exports the demo's
      // CapySession class under the ClaudeCliSession name.
      {
        find: /(.*)\/services\/claude-cli-session$/,
        replacement: path.resolve(__dirname, "src/adapters/demo-claude-cli-session"),
      },
      // Tauri module stubs
      { find: "@tauri-apps/plugin-shell", replacement: path.resolve(__dirname, "src/stubs/tauri-shell") },
      { find: "@tauri-apps/plugin-fs", replacement: path.resolve(__dirname, "src/stubs/tauri-fs") },
      { find: "@tauri-apps/plugin-store", replacement: path.resolve(__dirname, "src/stubs/tauri-store") },
      { find: "@tauri-apps/api/path", replacement: path.resolve(__dirname, "src/stubs/tauri-path") },
      { find: "@tauri-apps/plugin-dialog", replacement: path.resolve(__dirname, "src/stubs/tauri-dialog") },
      { find: "@tauri-apps/plugin-updater", replacement: path.resolve(__dirname, "src/stubs/tauri-updater") },
      { find: "@tauri-apps/plugin-process", replacement: path.resolve(__dirname, "src/stubs/tauri-process") },
      // App alias — same as desktop
      { find: "@/", replacement: path.resolve(__dirname, "../../packages/app/src/") },
      { find: "@", replacement: path.resolve(__dirname, "../../packages/app/src") },
    ],
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },
  test: {
    // Demo-only specs run under this config so they see the demo's
    // `__IS_DEMO__ = true` define and Tauri stubs — the exact environment
    // the demo ships in. The main suite runs against the desktop config.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
