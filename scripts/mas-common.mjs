// Shared helpers for the Mac App Store tooling (build / package / upload).
// Env vars are documented in README.md (§ Mac App Store build).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_TAURI = resolve(ROOT, "src-tauri");

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function readTauriConf() {
  try {
    return JSON.parse(readFileSync(resolve(SRC_TAURI, "tauri.conf.json"), "utf8"));
  } catch (err) {
    fail(`couldn't read src-tauri/tauri.conf.json: ${err.message}`);
  }
}

export function masTarget() {
  return process.env.MAS_TARGET ?? "universal-apple-darwin";
}

export function bundleDir() {
  return resolve(SRC_TAURI, "target", masTarget(), "release", "bundle", "macos");
}

export function appBundlePath() {
  return resolve(bundleDir(), `${readTauriConf().productName}.app`);
}

export function pkgPath() {
  return resolve(bundleDir(), `${readTauriConf().productName}.pkg`);
}

// The App Store upload counter (CFBundleVersion). Checked in so it stays
// monotonic across machines and sessions; App Store Connect rejects a reused
// build number. `build:mas` reads it (unless MAS_BUILD_NUMBER overrides);
// `upload:mas` bumps it past the number it just shipped.
const BUILD_NUMBER_FILE = resolve(SRC_TAURI, "mas-build-number.txt");

export function readBuildNumber() {
  if (!existsSync(BUILD_NUMBER_FILE)) return 1;
  const n = Number.parseInt(readFileSync(BUILD_NUMBER_FILE, "utf8").trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    fail(`src-tauri/mas-build-number.txt is not a positive integer`);
  }
  return n;
}

export function writeBuildNumber(n) {
  writeFileSync(BUILD_NUMBER_FILE, `${n}\n`);
}

// CFBundleVersion baked into the built .app — the authoritative record of what
// a given bundle will report to App Store Connect.
export function readAppBuildNumber(appPath) {
  try {
    return execFileSync(
      "plutil",
      ["-extract", "CFBundleVersion", "raw", "-o", "-", resolve(appPath, "Contents/Info.plist")],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return null;
  }
}
