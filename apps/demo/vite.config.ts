import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import path from "path";

export default defineConfig({
  base: process.env.DEMO_BASE_PATH ?? "/",
  define: {
    __PROJECT_ROOT__: JSON.stringify(""),
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
      // Override CapySession with demo stub (must precede the @/ catch-all)
      {
        find: /(.*)\/services\/capy-session$/,
        replacement: path.resolve(__dirname, "src/adapters/demo-capy-session"),
      },
      // Tauri module stubs
      { find: "@tauri-apps/plugin-shell", replacement: path.resolve(__dirname, "src/stubs/tauri-shell") },
      { find: "@tauri-apps/plugin-fs", replacement: path.resolve(__dirname, "src/stubs/tauri-fs") },
      { find: "@tauri-apps/api/path", replacement: path.resolve(__dirname, "src/stubs/tauri-path") },
      { find: "@tauri-apps/plugin-dialog", replacement: path.resolve(__dirname, "src/stubs/tauri-dialog") },
      // App alias — same as desktop
      { find: "@/", replacement: path.resolve(__dirname, "../../packages/app/src/") },
      { find: "@", replacement: path.resolve(__dirname, "../../packages/app/src") },
    ],
  },
  server: {
    port: 3000,
  },
});
