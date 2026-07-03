#!/usr/bin/env node
// Run the Rust test suite against the sandboxed Mac App Store configuration:
// the `mas` Cargo feature (security-scoped bookmarks) with default features
// off, so it compiles exactly the plugin set the store binary ships. The MAS
// overlay is fed through TAURI_CONFIG the same way `build:mas` feeds it via
// `--config`, so tauri-build validates against the sandboxed capability set.
// Env vars are documented in specs/RELEASING.md (§ Mac App Store).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fail, SRC_TAURI, writeMasArtifacts } from "./mas-common.mjs";

const { generatedConfig } = writeMasArtifacts();

try {
  execFileSync("cargo", ["test", "--no-default-features", "--features", "mas"], {
    cwd: SRC_TAURI,
    stdio: "inherit",
    env: { ...process.env, TAURI_CONFIG: readFileSync(generatedConfig, "utf8") },
  });
} catch {
  fail("cargo test (mas) failed — see output above.");
}
