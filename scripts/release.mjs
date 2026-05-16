#!/usr/bin/env node
// Bump the version across all sources of truth, then commit + tag.
// Usage: node scripts/release.mjs <version>     e.g. 0.2.0

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const version = process.argv[2];
if (!version) fail("missing version argument (e.g. 0.2.0)");
if (!SEMVER.test(version)) fail(`"${version}" is not a valid semver`);

function gitClean() {
  const out = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  if (out.trim().length > 0) fail("working tree is dirty — commit or stash first");
}

function bumpJson(relPath, key = "version") {
  const path = resolve(ROOT, relPath);
  const raw = readFileSync(path, "utf8");
  const m = raw.match(new RegExp(`("${key}"\\s*:\\s*")([^"]+)(")`));
  if (!m) fail(`couldn't find "${key}" in ${relPath}`);
  const next = raw.replace(m[0], `${m[1]}${version}${m[3]}`);
  writeFileSync(path, next);
  console.log(`  ${relPath}: ${m[2]} -> ${version}`);
}

function bumpCargoToml(relPath) {
  const path = resolve(ROOT, relPath);
  const raw = readFileSync(path, "utf8");
  // Only replace the version under [package], not under any nested table.
  const m = raw.match(/(\[package\][^[]*?version\s*=\s*")([^"]+)(")/s);
  if (!m) fail(`couldn't find [package] version in ${relPath}`);
  const next = raw.replace(m[0], `${m[1]}${version}${m[3]}`);
  writeFileSync(path, next);
  console.log(`  ${relPath}: ${m[2]} -> ${version}`);
}

function bumpCargoLock() {
  // Keep Cargo.lock in sync so `cargo build` doesn't re-resolve in CI.
  const path = resolve(ROOT, "src-tauri/Cargo.lock");
  const raw = readFileSync(path, "utf8");
  const re = /(name = "capybudget"\nversion = ")([^"]+)(")/;
  const m = raw.match(re);
  if (!m) {
    console.log("  src-tauri/Cargo.lock: capybudget entry not found (skipping)");
    return;
  }
  writeFileSync(path, raw.replace(re, `$1${version}$3`));
  console.log(`  src-tauri/Cargo.lock: ${m[2]} -> ${version}`);
}

gitClean();

console.log(`Bumping to v${version}:`);
bumpJson("package.json");
bumpJson("packages/app/package.json");
bumpJson("src-tauri/tauri.conf.json");
bumpCargoToml("src-tauri/Cargo.toml");
bumpCargoLock();

// Sync package-lock.json so the bumped root version lands in the
// lockfile too. Without this, the next `npm install` after a release
// rewrites the lockfile and dirties everyone's working tree.
console.log("Syncing package-lock.json (npm install --package-lock-only)…");
execSync("npm install --package-lock-only --no-audit --no-fund", {
  cwd: ROOT,
  stdio: "inherit",
});

const files = [
  "package.json",
  "package-lock.json",
  "packages/app/package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

execSync(`git add ${files.join(" ")}`, { cwd: ROOT, stdio: "inherit" });

// If versions were already at the target, there's nothing to commit.
// Skip the commit step so retries (e.g. after a failed push) are safe.
const staged = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8" }).trim();
if (staged.length === 0) {
  console.log(`No version changes to commit — HEAD already at v${version}.`);
} else {
  execSync(`git commit -m "chore: release v${version}"`, { cwd: ROOT, stdio: "inherit" });
}

// Create the tag only if it doesn't already exist at HEAD. If it
// exists elsewhere, bail — the caller needs to resolve that manually.
const existingTagCommit = execSync(`git rev-parse -q --verify "v${version}^{commit}" || true`, {
  cwd: ROOT,
  encoding: "utf8",
}).trim();
const headCommit = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
if (!existingTagCommit) {
  execSync(`git tag -a v${version} -m "v${version}"`, { cwd: ROOT, stdio: "inherit" });
} else if (existingTagCommit === headCommit) {
  console.log(`Tag v${version} already exists at HEAD.`);
} else {
  fail(`tag v${version} already exists at ${existingTagCommit.slice(0, 7)}, not HEAD (${headCommit.slice(0, 7)}). Delete it with \`git tag -d v${version}\` if you want to retag.`);
}

console.log("");
console.log(`Tagged v${version}.`);
console.log("Push to trigger the release workflow:");
console.log("");
console.log("    git push --follow-tags");
console.log("");
