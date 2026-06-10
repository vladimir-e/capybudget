/**
 * Export a generated demo scenario as a real on-disk budget folder — the same
 * files the desktop app writes (budget.json + accounts/categories/transactions
 * CSVs), so the folder opens in Capy like any user budget.
 *
 * Usage:
 *   npx tsx scripts/export-demo-budget.ts <output-dir> [options]
 *
 * Options:
 *   --profile <id>   demo scenario (default: no-stress)
 *   --end <date>     window end, YYYY-MM-DD (default: today)
 *   --years <n>      window length in whole years (default: 3)
 *   --seed <n>       PRNG seed (default: derived from profile id, like the demo app)
 *   --name <name>    budget name (default: output folder name)
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type {
  Account,
  BudgetBasis,
  BudgetMeta,
  Category,
  Transaction,
} from "@capybudget/core";
import { createCsvRepository } from "@capybudget/persistence";
import { nodeFileAdapter } from "@capybudget/mcp";
import {
  generateScenarioData,
  type ScenarioData,
} from "../apps/demo/src/data/generator";
import { PROFILES } from "../apps/demo/src/data/profiles";
import { seedFromString } from "../apps/demo/src/data/rng";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseEndDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) fail(`Invalid --end date "${value}" — expected YYYY-MM-DD.`);
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    fail(`Invalid --end date "${value}" — no such calendar day.`);
  }
  return date;
}

/** The app writes datetimes with milliseconds (`2026-06-30T09:00:00.000`);
 *  the generator emits them without. Insert `.000` so exported rows are
 *  indistinguishable from app-written ones. */
function withMillis(datetime: string): string {
  return datetime.replace(/(T\d{2}:\d{2}:\d{2})(?=Z|$)/, "$1.000");
}

/** Deterministic UUID (v4 layout) from a generator's synthetic id, so the
 *  exported folder carries app-native ids while identical inputs still
 *  reproduce identical output. */
function deterministicUuid(input: string): string {
  const bytes = createHash("sha256").update(input).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Rewrite generator output into the exact shape the app persists: UUID ids,
 *  millisecond datetimes, and object keys in canonical column order (the
 *  repository serializes with Papa.unparse, which derives CSV columns from
 *  the first object's keys). */
function toBudgetFolderData(data: ScenarioData, idNamespace: string): ScenarioData {
  const ids = new Map<string, string>();
  const mapId = (id: string): string => {
    if (id === "") return "";
    let mapped = ids.get(id);
    if (!mapped) {
      mapped = deterministicUuid(`${idNamespace}:${id}`);
      ids.set(id, mapped);
    }
    return mapped;
  };

  return {
    accounts: data.accounts.map(
      (a): Account => ({
        id: mapId(a.id),
        name: a.name,
        type: a.type,
        archived: a.archived,
        excludeFromNetWorth: a.excludeFromNetWorth,
        sortOrder: a.sortOrder,
        createdAt: withMillis(a.createdAt),
      }),
    ),
    categories: data.categories.map(
      (c): Category => ({
        id: mapId(c.id),
        name: c.name,
        group: c.group,
        archived: c.archived,
        sortOrder: c.sortOrder,
        assigned: c.assigned,
      }),
    ),
    transactions: data.transactions.map(
      (t): Transaction => ({
        id: mapId(t.id),
        datetime: withMillis(t.datetime),
        type: t.type,
        amount: t.amount,
        categoryId: mapId(t.categoryId),
        accountId: mapId(t.accountId),
        transferPairId: mapId(t.transferPairId),
        merchant: t.merchant,
        note: t.note,
        createdAt: withMillis(t.createdAt),
      }),
    ),
  };
}

function assertRoundTrip(label: string, written: unknown[], read: unknown[]): void {
  if (written.length !== read.length) {
    fail(`Round-trip mismatch: wrote ${written.length} ${label}, read back ${read.length}.`);
  }
  if (JSON.stringify(written) !== JSON.stringify(read)) {
    fail(`Round-trip mismatch: ${label} read back from disk differ from what was written.`);
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: "string", default: "no-stress" },
    end: { type: "string" },
    years: { type: "string", default: "3" },
    seed: { type: "string" },
    name: { type: "string" },
  },
});

if (positionals.length !== 1) {
  fail("Usage: npx tsx scripts/export-demo-budget.ts <output-dir> [--profile id] [--end YYYY-MM-DD] [--years n] [--seed n] [--name name]");
}

const profile = PROFILES[values.profile];
if (!profile) {
  fail(`Unknown profile "${values.profile}". Available: ${Object.keys(PROFILES).join(", ")}.`);
}

const outDir = resolve(positionals[0]);
const name = values.name ?? basename(outDir);
const end = values.end ? parseEndDate(values.end) : new Date();
const yearsBack = Number(values.years);
if (!Number.isInteger(yearsBack) || yearsBack < 1) {
  fail(`Invalid --years "${values.years}" — expected a positive integer.`);
}
const seed = values.seed ? Number(values.seed) : seedFromString(profile.id);
if (!Number.isFinite(seed)) fail(`Invalid --seed "${values.seed}" — expected a number.`);

const BUDGET_FILES = ["budget.json", "accounts.csv", "categories.csv", "transactions.csv"];
for (const file of BUDGET_FILES) {
  if (await nodeFileAdapter.exists(join(outDir, file))) {
    fail(`"${file}" already exists in ${outDir} — refusing to overwrite a budget folder.`);
  }
}
await mkdir(outDir, { recursive: true });

const data = toBudgetFolderData(
  generateScenarioData(profile, { now: end, yearsBack, seed }),
  `${profile.id}:${seed}`,
);

const nowIso = new Date().toISOString();
const meta = {
  schemaVersion: 3,
  name,
  currency: "USD",
  createdAt: nowIso,
  lastModified: nowIso,
  basis: "sameMonthLastYear",
} satisfies BudgetMeta & { basis: BudgetBasis };
await writeFile(join(outDir, "budget.json"), JSON.stringify(meta, null, 2), "utf-8");

const writer = createCsvRepository(outDir, nodeFileAdapter, { immediate: true });
await writer.saveAccounts(data.accounts);
await writer.saveCategories(data.categories);
await writer.saveTransactions(data.transactions);
await writer.dispose();

const reader = createCsvRepository(outDir, nodeFileAdapter);
const accounts = await reader.getAccounts();
const categories = await reader.getCategories();
const transactions = await reader.getTransactions();
assertRoundTrip("accounts", data.accounts, accounts);
assertRoundTrip("categories", data.categories, categories);
assertRoundTrip("transactions", data.transactions, transactions);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const window = `${transactions[0].datetime.slice(0, 10)} → ${transactions[transactions.length - 1].datetime.slice(0, 10)}`;

console.log(`Budget "${name}" written to ${outDir}`);
console.log(`  Profile ${profile.id}, seed ${seed}, window ${window}`);
console.log(`  ${accounts.length} accounts, ${categories.length} categories, ${transactions.length} transactions`);
console.log("  Final balances:");
for (const account of accounts) {
  const balance = transactions.reduce(
    (sum, t) => (t.accountId === account.id ? sum + t.amount : sum),
    0,
  );
  console.log(`    ${account.name}: ${usd.format(balance / 100)}`);
}
