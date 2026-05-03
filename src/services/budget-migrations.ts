import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import Papa from "papaparse";
import type { BudgetMeta } from "@capybudget/core";

/** A migration transforms a budget folder from version `from` to `from + 1`.
 *  Migrations are pure-ish: they read and rewrite files in place, no other side
 *  effects. They MUST be idempotent — re-running them on already-migrated data
 *  must be a no-op. */
type Migration = (folderPath: string) => Promise<void>;

/** Sequentially-numbered migrations. `MIGRATIONS[n]` upgrades v(n) → v(n+1). */
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: add `excludeFromNetWorth` column to accounts.csv (default false).
  1: async (folderPath) => {
    const accountsPath = await join(folderPath, "accounts.csv");
    const raw = await readTextFile(accountsPath);
    const parsed = Papa.parse<Record<string, string>>(raw, {
      header: true,
      skipEmptyLines: true,
    });

    const fields = parsed.meta.fields ?? [];
    if (fields.includes("excludeFromNetWorth")) return; // already migrated

    const nextRows = parsed.data.map((row) => ({
      ...row,
      excludeFromNetWorth: "false",
    }));
    const nextFields = insertAfter(fields, "archived", "excludeFromNetWorth");

    const csv = Papa.unparse(nextRows, { columns: nextFields });
    await writeTextFile(accountsPath, csv);
  },
};

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
  return {
    ...meta,
    schemaVersion: targetVersion,
    lastModified: new Date().toISOString(),
  };
}

function insertAfter(arr: string[], anchor: string, value: string): string[] {
  const idx = arr.indexOf(anchor);
  if (idx === -1) return [...arr, value];
  return [...arr.slice(0, idx + 1), value, ...arr.slice(idx + 1)];
}
