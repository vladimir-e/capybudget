/**
 * Key-parity check for the locale catalogs. Every non-source locale must have
 * exactly the same keys as `en`, per namespace; plural variants (`key_one`,
 * `key_few`, …) collapse to their base key first since they legitimately differ
 * across languages. Also cross-validates that the directories on disk and the
 * `SUPPORTED_LOCALES` registry agree, so a half-registered language can't pass.
 *
 * On top of base-key parity it checks plural *completeness*: every plural group
 * must cover exactly the categories that locale's `Intl.PluralRules` declares
 * (`one`/`other` for en, `one`/`few`/`many`/`other` for ru, …). Base-key parity
 * alone can't see this — it strips the suffix — so a missing required plural
 * form would otherwise ship silently.
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

/** The CLDR plural categories a locale's cardinal rules declare. Cached per
 *  locale — the set is what every plural group in that locale must provide. */
const pluralCategoryCache = new Map<string, Set<string>>();
function requiredPluralCategories(locale: string): Set<string> {
  let cats = pluralCategoryCache.get(locale);
  if (!cats) {
    cats = new Set(new Intl.PluralRules(locale).resolvedOptions().pluralCategories);
    pluralCategoryCache.set(locale, cats);
  }
  return cats;
}

/** Group every suffixed plural key in a namespace by its base, mapping each base
 *  to the set of suffixes present. Non-plural keys are ignored. */
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

/** Plural-completeness problems for one locale/namespace: each plural group must
 *  cover exactly the locale's required CLDR categories — no missing form a
 *  consumer would fall back on, no stray form that does nothing. */
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
    // Every locale (including the source) must have complete plural groups for
    // its own CLDR categories — en's `one`/`other`, ru's `one`/`few`/`many`/
    // `other`, etc. This is orthogonal to cross-locale key parity below.
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
