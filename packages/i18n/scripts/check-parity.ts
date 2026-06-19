/**
 * Validates that every non-source locale has exactly the same keys as `en`,
 * per namespace. Plural variants (`key_one`, `key_few`, …) differ legitimately
 * across languages, so they collapse to their base key before comparison.
 *
 * Exits non-zero on any missing or extra key — the guardrail that keeps a
 * contributor PR ("copy en/, translate the values") from silently shipping a
 * half-translated or drifted catalog.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");
const SOURCE_LOCALE = "en";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(obj: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix.replace(PLURAL_SUFFIX, ""));
  }
  return out;
}

function readNamespaceKeys(locale: string, namespace: string): Set<string> {
  const raw = readFileSync(join(LOCALES_DIR, locale, namespace), "utf8");
  return flatten(JSON.parse(raw));
}

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const namespaces = readdirSync(join(LOCALES_DIR, SOURCE_LOCALE)).filter((f) =>
  f.endsWith(".json"),
);

const problems: string[] = [];

for (const locale of locales) {
  if (locale === SOURCE_LOCALE) continue;
  for (const namespace of namespaces) {
    const source = readNamespaceKeys(SOURCE_LOCALE, namespace);
    let target: Set<string>;
    try {
      target = readNamespaceKeys(locale, namespace);
    } catch {
      problems.push(`${locale}/${namespace}: file missing`);
      continue;
    }
    const missing = [...source].filter((k) => !target.has(k));
    const extra = [...target].filter((k) => !source.has(k));
    for (const k of missing) problems.push(`${locale}/${namespace}: missing key "${k}"`);
    for (const k of extra) problems.push(`${locale}/${namespace}: extra key "${k}"`);
  }
}

if (problems.length > 0) {
  console.error(`i18n:check failed — ${problems.length} issue(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(
  `i18n:check passed — ${locales.length} locale(s) × ${namespaces.length} namespace(s), keys in parity with "${SOURCE_LOCALE}".`,
);
