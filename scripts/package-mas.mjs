#!/usr/bin/env node
// Package the built Mac App Store .app into a .pkg installer via productbuild.
// Run `npm run build:mas` first. Env vars are documented in specs/RELEASING.md.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appBundlePath, pkgPath, readAppBuildNumber, fail } from "./mas-common.mjs";

const app = appBundlePath();
const pkg = pkgPath();

if (!existsSync(app)) {
  fail(`no .app at ${app}\n       Run \`npm run build:mas\` first (matching MAS_TARGET).`);
}

const identity = process.env.APPLE_INSTALLER_IDENTITY ?? "";
if (!identity) {
  console.warn(
    "warning: APPLE_INSTALLER_IDENTITY is unset — building an UNSIGNED .pkg.\n" +
      "         Good for local smoke tests; App Store Connect rejects it.\n" +
      "         Set it to your 'Mac Installer Distribution' identity to sign.",
  );
}

const buildNumber = readAppBuildNumber(app);
console.log(
  `Packaging ${app.split("/").pop()} (build ${buildNumber ?? "?"}) → ${pkg.split("/").pop()}` +
    (identity ? ` — signed as "${identity}"` : " — UNSIGNED"),
);

const args = ["productbuild", "--component", app, "/Applications"];
if (identity) args.push("--sign", identity);
args.push(pkg);

try {
  execFileSync("xcrun", args, { stdio: "inherit" });
} catch {
  fail("productbuild failed — see output above.");
}

console.log(`\nWrote ${pkg}`);
if (identity) {
  console.log("Verify the signature:  pkgutil --check-signature '" + pkg + "'");
  console.log("Upload:                npm run upload:mas");
} else {
  console.log("Inspect:  installer -pkginfo -pkg '" + pkg + "'");
}
