/**
 * Key-parity check for the locale catalogs. Every non-source locale must have
 * exactly the same keys as `en`, per namespace; plural variants (`key_one`,
 * `key_few`, …) collapse to their base key first since they legitimately differ
 * across languages. Also cross-validates that the directories on disk and the
 * `SUPPORTED_LOCALES` registry agree, so a half-registered language can't pass.
 *
 * Pure (returns problems, doesn't exit) so both the CLI wrapper and the vitest
 * suite can drive it — the test is what makes parity drift fail `npm test`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SUPPORTED_LOCALES } from "../src/locales";

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

export interface ParityReport {
  problems: string[];
  localeCount: number;
  namespaceCount: number;
}

export function checkParity(): ParityReport {
  const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const namespaces = readdirSync(join(LOCALES_DIR, SOURCE_LOCALE)).filter((f) =>
    f.endsWith(".json"),
  );

  const problems: string[] = [];

  // A locale on disk that isn't in SUPPORTED_LOCALES never loads (resources
  // globs only registered codes); a registered code with no directory crashes
  // at init. Either way the picker and the catalog drift apart — flag both.
  const registered = new Set<string>(SUPPORTED_LOCALES.map((l) => l.code));
  const onDisk = new Set(locales);
  for (const locale of onDisk) {
    if (!registered.has(locale)) {
      problems.push(`${locale}: catalog exists but is not in SUPPORTED_LOCALES (locales.ts)`);
    }
  }
  for (const locale of registered) {
    if (!onDisk.has(locale)) {
      problems.push(`${locale}: in SUPPORTED_LOCALES but has no locales/${locale}/ directory`);
    }
  }

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

  return { problems, localeCount: locales.length, namespaceCount: namespaces.length };
}
