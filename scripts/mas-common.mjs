// Shared helpers for the Mac App Store tooling (build / package / upload).
// Env vars are documented in README.md (§ Mac App Store build).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_TAURI = resolve(ROOT, "src-tauri");

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function readText(relPath) {
  try {
    return readFileSync(resolve(SRC_TAURI, relPath), "utf8");
  } catch (err) {
    fail(`couldn't read src-tauri/${relPath}: ${err.message}`);
  }
}

export function readJson(relPath) {
  try {
    return JSON.parse(readText(relPath));
  } catch (err) {
    fail(`couldn't parse src-tauri/${relPath}: ${err.message}`);
  }
}

// The .app/.pkg take their name from productName in the base tauri.conf.json —
// the MAS overlay never renames the product, so both build variants match.
function productName() {
  return readJson("tauri.conf.json").productName;
}

function masTarget() {
  return process.env.MAS_TARGET ?? "universal-apple-darwin";
}

function bundleDir() {
  return resolve(SRC_TAURI, "target", masTarget(), "release", "bundle", "macos");
}

export function appBundlePath() {
  return resolve(bundleDir(), `${productName()}.app`);
}

export function pkgPath() {
  return resolve(bundleDir(), `${productName()}.pkg`);
}

// The App Store upload counter (CFBundleVersion). Checked in so it stays
// monotonic across machines and sessions; App Store Connect rejects a reused
// build number. `build:mas` reads it (unless MAS_BUILD_NUMBER overrides);
// `upload:mas` bumps it past the number it just shipped.
const BUILD_NUMBER_FILE = resolve(SRC_TAURI, "mas-build-number.txt");

export function readBuildNumber() {
  if (!existsSync(BUILD_NUMBER_FILE)) return 1;
  const raw = readFileSync(BUILD_NUMBER_FILE, "utf8").trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    fail(`src-tauri/mas-build-number.txt must be a positive integer, got "${raw}"`);
  }
  return Number.parseInt(raw, 10);
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
