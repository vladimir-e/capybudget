#!/usr/bin/env node
// Upload the signed Mac App Store .pkg to App Store Connect via altool, using
// an App Store Connect API key (.p8). Run `npm run package:mas` first (signed).
// Env vars are documented in README.md (§ Mac App Store build).
//
// Transporter.app (Apple's GUI) is the manual fallback if this path breaks:
// drag the .pkg into it and sign in with the same API key.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  pkgPath,
  appBundlePath,
  readAppBuildNumber,
  readBuildNumber,
  writeBuildNumber,
  fail,
} from "./mas-common.mjs";

const keyId = process.env.APPLE_API_KEY_ID ?? "";
const issuer = process.env.APPLE_API_ISSUER ?? "";
const keyPath = process.env.APPLE_API_KEY_PATH ?? "";

const missing = [];
if (!keyId) missing.push("APPLE_API_KEY_ID (App Store Connect key ID)");
if (!issuer) missing.push("APPLE_API_ISSUER (issuer UUID)");
if (!keyPath) missing.push("APPLE_API_KEY_PATH (path to AuthKey_*.p8)");
if (missing.length) {
  fail(`missing App Store Connect API credentials:\n       - ${missing.join("\n       - ")}`);
}

if (!existsSync(keyPath)) fail(`API key file not found: ${keyPath}`);

const pkg = pkgPath();
if (!existsSync(pkg)) {
  fail(`no .pkg at ${pkg}\n       Run \`npm run package:mas\` first (matching MAS_TARGET).`);
}

// App Store Connect only accepts a .pkg signed with a Mac Installer
// Distribution certificate. Catch the unsigned local-smoke .pkg before the
// upload round-trips and fails opaquely.
let signature = "";
try {
  signature = execFileSync("pkgutil", ["--check-signature", pkg], { encoding: "utf8" });
} catch (err) {
  signature = err.stdout?.toString() ?? "";
}
if (!/Status:\s*signed/i.test(signature)) {
  fail(
    `${pkg.split("/").pop()} is not signed.\n` +
      "       Re-run `npm run package:mas` with APPLE_INSTALLER_IDENTITY set to a\n" +
      "       'Mac Installer Distribution' identity. App Store Connect rejects unsigned packages.",
  );
}

const app = appBundlePath();
const uploaded = (existsSync(app) && readAppBuildNumber(app)) || null;

console.log(`Uploading ${pkg.split("/").pop()} (build ${uploaded ?? "?"}) to App Store Connect…`);

try {
  execFileSync(
    "xcrun",
    [
      "altool",
      "--upload-app",
      "--type",
      "macos",
      "--file",
      pkg,
      "--apiKey",
      keyId,
      "--apiIssuer",
      issuer,
      "--p8-file-path",
      keyPath,
    ],
    { stdio: "inherit" },
  );
} catch {
  fail("altool upload failed — see output above.");
}

// Burn the shipped build number so the next build gets a fresh one. ASC
// rejects reuse. Commit the bump.
const next = (uploaded ? Number.parseInt(uploaded, 10) : readBuildNumber()) + 1;
writeBuildNumber(next);
console.log(`\nUpload accepted. Bumped mas-build-number.txt → ${next} (commit it).`);
console.log("Then finish the submission in App Store Connect.");
