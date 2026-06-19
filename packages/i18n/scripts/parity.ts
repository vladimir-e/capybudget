// Plural variants collapse to their base key before cross-locale parity, since
// the per-suffix forms legitimately differ across languages. Completeness is a
// separate pass: base-key parity strips the suffix and can't see a missing
// required plural form. Pure (returns problems, no exit) so both the CLI wrapper
// and the vitest suite can drive it.
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

function flattenRaw(obj: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj)) {
      flattenRaw(value, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

function parseNamespace(locale: string, namespace: string): unknown {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, namespace), "utf8"));
}

function readNamespaceKeys(locale: string, namespace: string): Set<string> {
  return flatten(parseNamespace(locale, namespace));
}

const pluralCategoryCache = new Map<string, Set<string>>();
function requiredPluralCategories(locale: string): Set<string> {
  let cats = pluralCategoryCache.get(locale);
  if (!cats) {
    cats = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    pluralCategoryCache.set(locale, cats);
  }
  return cats;
}

function pluralGroups(raw: Set<string>): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const key of raw) {
    const match = key.match(PLURAL_SUFFIX);
    if (!match) continue;
    const base = key.replace(PLURAL_SUFFIX, "");
    let suffixes = groups.get(base);
    if (!suffixes) {
      suffixes = new Set<string>();
      groups.set(base, suffixes);
    }
    suffixes.add(match[1]);
  }
  return groups;
}

function pluralProblems(locale: string, namespace: string): string[] {
  const required = requiredPluralCategories(locale);
  const groups = pluralGroups(flattenRaw(parseNamespace(locale, namespace)));
  const problems: string[] = [];
  for (const [base, suffixes] of groups) {
    const missing = [...required].filter((c) => !suffixes.has(c));
    const extra = [...suffixes].filter((c) => !required.has(c));
    for (const c of missing) {
      problems.push(`${locale}/${namespace}: plural "${base}" missing required form "_${c}"`);
    }
    for (const c of extra) {
      problems.push(`${locale}/${namespace}: plural "${base}" has form "_${c}" not in ${locale}'s plural rules`);
    }
  }
  return problems;
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

  // A catalog not in SUPPORTED_LOCALES never loads (resources globs only
  // registered codes); a registered code with no directory crashes at init.
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
    // Completeness is per-locale over its own CLDR categories (en's one/other,
    // ru's one/few/many/other) — orthogonal to the cross-locale key parity below.
    for (const namespace of namespaces) {
      try {
        problems.push(...pluralProblems(locale, namespace));
      } catch {
        // A missing/unparseable file surfaces as a parity problem below.
      }
    }

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
