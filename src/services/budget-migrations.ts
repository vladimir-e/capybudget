import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import Papa from "papaparse";
import type { BudgetMeta } from "@capybudget/core";
import { resolveBudgetFormat } from "@capybudget/core";

/** Backfill `currency` and the format fields from the currency's defaults for a
 *  budget.json written before those fields existed. Idempotent. */
export function withFormatDefaults(meta: BudgetMeta): BudgetMeta {
  const { currency, decimals, symbolPosition } = resolveBudgetFormat(meta);
  return {
    ...meta,
    currency,
    currencyDecimals: decimals,
    currencySymbolPosition: symbolPosition,
  };
}

/** A migration transforms a budget folder from version `from` to `from + 1`.
 *  Migrations are pure-ish: they read and rewrite files in place, no other side
 *  effects. They MUST be idempotent — re-running them on already-migrated data
 *  must be a no-op. */
type Migration = (folderPath: string) => Promise<void>;

/** Add a column to a budget CSV, filling every existing row with `fill` and
 *  inserting it after `anchor`. Idempotent: a no-op if the column already
 *  exists. Header-only files keep their header — an empty data set still writes
 *  the column list, never a blank file. */
async function addColumn(
  folderPath: string,
  file: string,
  column: string,
  anchor: string,
  fill: string,
): Promise<void> {
  const path = await join(folderPath, file);
  const parsed = Papa.parse<Record<string, string>>(await readTextFile(path), {
    header: true,
    skipEmptyLines: true,
  });

  const fields = parsed.meta.fields ?? [];
  if (fields.includes(column)) return; // already migrated

  const nextFields = insertAfter(fields, anchor, column);
  const nextRows = parsed.data.map((row) => ({ ...row, [column]: fill }));

  // Papa.unparse drops the header for an empty data array, which would blank
  // the file; write the header line ourselves in that case.
  const csv =
    nextRows.length === 0
      ? nextFields.join(",")
      : Papa.unparse(nextRows, { columns: nextFields });
  await writeTextFile(path, csv);
}

/** Sequentially-numbered migrations. `MIGRATIONS[n]` upgrades v(n) → v(n+1). */
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: add `excludeFromNetWorth` column to accounts.csv (default false).
  1: (folderPath) =>
    addColumn(folderPath, "accounts.csv", "excludeFromNetWorth", "archived", "false"),

  // v2 → v3: add `assigned` column to categories.csv. Empty cell = null
  // = untracked (matches parseCsv's nullable-int coercion). Forward-compatible
  // — pre-v3 CSVs read fine without this rewrite, but we still materialize
  // the column on disk so the file format matches the schema version.
  2: (folderPath) =>
    addColumn(folderPath, "categories.csv", "assigned", "sortOrder", ""),

  // v3 → v4: per-account currency + per-transaction fx rate. accounts.csv
  // gains `currency`, stamped with the budget default for every existing
  // account; transactions.csv gains `fxRate`, left empty everywhere (empty =
  // default currency = 1.0). Behavior-identical: a single-currency budget reads
  // back the same numbers because every account is in the default and the
  // converter stays the identity.
  3: async (folderPath) => {
    const defaultCurrency = await readDefaultCurrency(folderPath);
    await addColumn(folderPath, "accounts.csv", "currency", "createdAt", defaultCurrency);
    await addColumn(folderPath, "transactions.csv", "fxRate", "createdAt", "");
  },
};

/** Read the budget's default currency from budget.json, falling back to the
 *  currency's defaults the same way every other reader does. The v4 migration
 *  stamps this onto every existing account. */
async function readDefaultCurrency(folderPath: string): Promise<string> {
  const metaPath = await join(folderPath, "budget.json");
  const meta = JSON.parse(await readTextFile(metaPath)) as BudgetMeta;
  return resolveBudgetFormat(meta).currency;
}

/** Run all pending migrations on `folderPath`, bringing it from
 *  `meta.schemaVersion` up to `targetVersion`. Returns the updated meta. */
export async function migrateBudgetFolder(
  folderPath: string,
  meta: BudgetMeta,
  targetVersion: number,
): Promise<BudgetMeta> {
  let version = meta.schemaVersion;
  while (version < targetVersion) {
    const migration = MIGRATIONS[version];
    if (!migration) {
      throw new Error(
        `No migration registered for schema version ${version} → ${version + 1}`,
      );
    }
    await migration(folderPath);
    version++;
  }
  return withFormatDefaults({
    ...meta,
    schemaVersion: targetVersion,
    lastModified: new Date().toISOString(),
  });
}

function insertAfter(arr: string[], anchor: string, value: string): string[] {
  const idx = arr.indexOf(anchor);
  if (idx === -1) return [...arr, value];
  return [...arr.slice(0, idx + 1), value, ...arr.slice(idx + 1)];
}
