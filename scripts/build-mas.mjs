#!/usr/bin/env node
// Build the Mac App Store variant: sandboxed .app from the tauri.mas overlay,
// with the `mas` Cargo feature and the __MAS__ Vite define enabled.
// Env vars are documented in README.md (§ Mac App Store build).

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fail, SRC_TAURI, readText, readJson, readBuildNumber } from "./mas-common.mjs";

const ROOT = dirname(SRC_TAURI);

const teamId = process.env.APPLE_TEAM_ID ?? "";
const buildNumber = process.env.MAS_BUILD_NUMBER ?? String(readBuildNumber());
const target = process.env.MAS_TARGET ?? "universal-apple-darwin";

const identifier = readJson("tauri.conf.json").identifier;

if (!teamId) {
  console.warn(
    "warning: APPLE_TEAM_ID is unset — entitlements will carry an empty team ID.\n" +
      "         The build runs for validation but is not App Store submittable.",
  );
}

const entitlements = readText("Entitlements.mas.plist.template")
  .replaceAll("${APPLE_TEAM_ID}", () => teamId)
  .replaceAll("${APP_IDENTIFIER}", () => identifier);
writeFileSync(resolve(SRC_TAURI, "Entitlements.mas.plist"), entitlements);

// Derive the concrete overlay from the committed one: stamp the build number,
// and drop the provisioning profile mapping when the file isn't present so
// local (unsigned) builds still complete.
const overlay = readJson("tauri.mas.conf.json");
overlay.bundle.macOS.bundleVersion = buildNumber;

const profilePath = resolve(SRC_TAURI, "embedded.provisionprofile");
if (!existsSync(profilePath)) {
  console.warn(
    "warning: src-tauri/embedded.provisionprofile not found — building without it.\n" +
      "         Supply the Mac App Store provisioning profile there before submitting.",
  );
  delete overlay.bundle.macOS.files["embedded.provisionprofile"];
}

const generatedConfig = resolve(SRC_TAURI, "tauri.mas.generated.json");
writeFileSync(generatedConfig, JSON.stringify(overlay, null, 2) + "\n");

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
