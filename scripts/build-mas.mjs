#!/usr/bin/env node
// Build the Mac App Store variant: sandboxed .app from the tauri.mas overlay,
// with the `mas` Cargo feature and the __MAS__ Vite define enabled.
// Env vars are documented in specs/RELEASING.md (§ Mac App Store).

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fail, SRC_TAURI, writeMasArtifacts } from "./mas-common.mjs";

const ROOT = dirname(SRC_TAURI);

const target = process.env.MAS_TARGET ?? "universal-apple-darwin";

const { generatedConfig, identifier, buildNumber, teamId, hasProvisionProfile } =
  writeMasArtifacts();

if (!teamId) {
  console.warn(
    "warning: APPLE_TEAM_ID is unset — entitlements will carry an empty team ID.\n" +
      "         The build runs for validation but is not App Store submittable.",
  );
}

if (!hasProvisionProfile) {
  console.warn(
    "warning: src-tauri/embedded.provisionprofile not found — building without it.\n" +
      "         Supply the Mac App Store provisioning profile there before submitting.",
  );
}

console.log(
  `Building MAS variant: target=${target} build=${buildNumber} identifier=${identifier}`,
);

try {
  execFileSync(
    "npm",
    [
      "run",
      "tauri",
      "--",
      "build",
      "--config",
      generatedConfig,
      "--features",
      "mas",
      "--target",
      target,
      // The tauri CLI has no --no-default-features flag; forward it to cargo
      // (the runner) after `--` so the `updater` + `shell-spawn` default
      // features — and their crates — are excluded from the MAS binary.
      "--",
      "--no-default-features",
    ],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, CAPY_MAS: "1" } },
  );
} catch {
  fail("tauri build failed — see output above.");
}
