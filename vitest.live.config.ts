import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const root = __dirname;
const liveDir = "packages/app/src/test/live";
const tauriNode = path.resolve(root, liveDir, "tauri-node.ts");
const envFile = path.resolve(root, ".env.live");
const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf-8")) : {};

export default defineConfig({
  define: {
    __PROJECT_ROOT__: JSON.stringify(root),
    __IS_DEMO__: JSON.stringify(false),
    __MAS__: JSON.stringify(false),
  },
  resolve: {
    alias: {
      "@tauri-apps/plugin-shell": tauriNode,
      "@": path.resolve(root, "packages/app/src"),
    },
  },
  test: {
    include: [`${liveDir}/**/*.live.ts`],
    environment: "node",
    env: Object.fromEntries(
      Object.entries(fileEnv).filter(([key, value]) => value && !process.env[key]),
    ) as Record<string, string>,
    fileParallelism: false,
    testTimeout: 360_000,
    hookTimeout: 60_000,
    reporters: ["default", `./${liveDir}/grid-reporter.ts`],
  },
});
