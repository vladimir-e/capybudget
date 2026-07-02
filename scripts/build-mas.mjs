#!/usr/bin/env node
// Build the Mac App Store variant: sandboxed .app from the tauri.mas overlay,
// with the `mas` Cargo feature and the __MAS__ Vite define enabled.
//
// Env:
//   APPLE_TEAM_ID          Apple Developer team ID, baked into the entitlements
//                          (com.apple.application-identifier / team-identifier).
//                          Required for a submittable build; without it the
//                          build still runs (unsigned) so the path is exercised.
//   APPLE_SIGNING_IDENTITY "Apple Distribution: … (TEAMID)" identity. Read by
//                          Tauri itself (same env the release pipeline uses);
//                          unset means Tauri skips signing and emits an
//                          unsigned .app.
//   MAS_BUILD_NUMBER       CFBundleVersion — monotonic per App Store upload,
//                          distinct from the semver. Defaults to "1".
//   MAS_TARGET             Rust target triple. Defaults to the universal binary;
//                          override to e.g. aarch64-apple-darwin for fast local
//                          iteration.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = resolve(ROOT, "src-tauri");

const teamId = process.env.APPLE_TEAM_ID ?? "";
const buildNumber = process.env.MAS_BUILD_NUMBER ?? "1";
const target = process.env.MAS_TARGET ?? "universal-apple-darwin";

const identifier = JSON.parse(
  readFileSync(resolve(SRC_TAURI, "tauri.conf.json"), "utf8"),
).identifier;

if (!teamId) {
  console.warn(
    "warning: APPLE_TEAM_ID is unset — entitlements will carry an empty team ID.\n" +
      "         The build runs for validation but is not App Store submittable.",
  );
}

// Resolve the entitlements template into the concrete plist Tauri signs with.
const entitlements = readFileSync(
  resolve(SRC_TAURI, "Entitlements.mas.plist.template"),
  "utf8",
)
  .replaceAll("${APPLE_TEAM_ID}", teamId)
  .replaceAll("${APP_IDENTIFIER}", identifier);
writeFileSync(resolve(SRC_TAURI, "Entitlements.mas.plist"), entitlements);

// Derive the concrete overlay from the committed one: stamp the build number,
// and drop the provisioning profile mapping when the file isn't present so
// local (unsigned) builds still complete.
const overlay = JSON.parse(
  readFileSync(resolve(SRC_TAURI, "tauri.mas.conf.json"), "utf8"),
);
overlay.bundle.macOS.bundleVersion = buildNumber;

const profilePath = resolve(SRC_TAURI, "embedded.provisionprofile");
if (!existsSync(profilePath)) {
  console.warn(
    "warning: src-tauri/embedded.provisionprofile not found — building without it.\n" +
      "         Supply the Mac App Store provisioning profile there before submitting.",
  );
  delete overlay.bundle.macOS.files;
}

const generatedConfig = resolve(SRC_TAURI, "tauri.mas.generated.json");
writeFileSync(generatedConfig, JSON.stringify(overlay, null, 2) + "\n");

console.log(
  `Building MAS variant: target=${target} build=${buildNumber} identifier=${identifier}`,
);

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
  ],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, CAPY_MAS: "1" } },
);
