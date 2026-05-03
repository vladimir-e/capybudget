import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BudgetMeta, Category } from "@capybudget/core";
import { DEFAULT_CATEGORIES } from "@capybudget/core";
import Papa from "papaparse";
import { migrateBudgetFolder } from "./budget-migrations";

export const SCHEMA_VERSION = 3;
const BUDGET_FILE = "budget.json";

/** Detect a budget folder, run any pending schema migrations, and return the
 *  (possibly updated) BudgetMeta. Returns null if the folder is not a budget. */
export async function detectBudget(folderPath: string): Promise<BudgetMeta | null> {
  const metaPath = await join(folderPath, BUDGET_FILE);
  const fileExists = await exists(metaPath);
  if (!fileExists) return null;

  const raw = await readTextFile(metaPath);
  const meta = JSON.parse(raw) as BudgetMeta;

  if (meta.schemaVersion < SCHEMA_VERSION) {
    const migrated = await migrateBudgetFolder(folderPath, meta, SCHEMA_VERSION);
    await writeTextFile(metaPath, JSON.stringify(migrated, null, 2));
    return migrated;
  }

  return meta;
}

export async function bootstrapBudget(folderPath: string, name: string): Promise<BudgetMeta> {
  const now = new Date().toISOString();
  const meta: BudgetMeta = {
    schemaVersion: SCHEMA_VERSION,
    name,
    currency: "USD",
    createdAt: now,
    lastModified: now,
  };

  // Ensure directory exists
  await mkdir(folderPath, { recursive: true }).catch(() => {});

  // Write budget.json
  const metaPath = await join(folderPath, BUDGET_FILE);
  await writeTextFile(metaPath, JSON.stringify(meta, null, 2));

  // Write default categories.csv. Empty `assigned` cells = null = untracked,
  // matching how parseCsv reads pre-v3 budgets.
  const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
  }));
  const categoriesCsv = Papa.unparse(categories, {
    columns: ["id", "name", "group", "archived", "sortOrder", "assigned"],
  });
  const categoriesPath = await join(folderPath, "categories.csv");
  await writeTextFile(categoriesPath, categoriesCsv);

  // Write empty accounts.csv
  const accountsPath = await join(folderPath, "accounts.csv");
  await writeTextFile(accountsPath, "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt");

  // Write empty transactions.csv
  const transactionsPath = await join(folderPath, "transactions.csv");
  await writeTextFile(transactionsPath, "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt");

  return meta;
}
