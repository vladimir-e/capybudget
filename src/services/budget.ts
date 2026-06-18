import { exists, readTextFile, writeTextFile, readDir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BudgetMeta, Category } from "@capybudget/core";
import { DEFAULT_CATEGORIES, DEFAULT_CURRENCY } from "@capybudget/core";
import {
  unparseCsv,
  ACCOUNT_COLUMNS,
  CATEGORY_COLUMNS,
  TRANSACTION_COLUMNS,
} from "@capybudget/persistence";
import { migrateBudgetFolder } from "./budget-migrations";

export const SCHEMA_VERSION = 3;
const BUDGET_FILE = "budget.json";

export interface FolderInfo {
  hasBudget: boolean;
  isEmpty: boolean;
  itemCount: number;
}

/** Inspect a folder: check for budget.json and count visible entries.
 *  Hidden entries (dotfiles like `.capy`, `.git`, `.DS_Store`) don't count —
 *  a folder that looks empty in Finder should be usable for a new budget.
 *  `bootstrapBudget`'s PROTECTED_FILES guard still catches collisions with
 *  the canonical files (none of which start with `.`). */
export async function inspectFolder(folderPath: string): Promise<FolderInfo> {
  const metaPath = await join(folderPath, BUDGET_FILE);
  const hasBudget = await exists(metaPath);
  const entries = await readDir(folderPath);
  const visible = entries.filter((e) => !e.name.startsWith("."));
  return {
    hasBudget,
    isEmpty: visible.length === 0,
    itemCount: visible.length,
  };
}

/** Given a list of folder paths, return the subset whose `budget.json` no
 *  longer exists. Used at app launch to prune dead recents. Errors per-path
 *  (e.g. permission denied, folder unmounted) count as "missing". */
export async function findMissingBudgetPaths(paths: string[]): Promise<string[]> {
  const checks = await Promise.all(
    paths.map(async (path) => {
      try {
        const metaPath = await join(path, BUDGET_FILE);
        return { path, exists: await exists(metaPath) };
      } catch {
        return { path, exists: false };
      }
    }),
  );
  return checks.filter((c) => !c.exists).map((c) => c.path);
}

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

const PROTECTED_FILES = ["budget.json", "categories.csv", "accounts.csv", "transactions.csv"];

/** Bootstrap a new budget in a folder the caller has already validated as
 *  empty (via inspectFolder). The PROTECTED_FILES guard below is defensive
 *  — it catches races and any future caller that skips inspection. */
export async function bootstrapBudget(
  folderPath: string,
  name: string,
  currency: string = DEFAULT_CURRENCY,
): Promise<BudgetMeta> {
  for (const file of PROTECTED_FILES) {
    const filePath = await join(folderPath, file);
    if (await exists(filePath)) {
      throw new Error(`Cannot create budget: "${file}" already exists in this folder.`);
    }
  }

  const now = new Date().toISOString();
  const meta: BudgetMeta = {
    schemaVersion: SCHEMA_VERSION,
    name,
    currency,
    createdAt: now,
    lastModified: now,
  };

  // Write budget.json
  const metaPath = await join(folderPath, BUDGET_FILE);
  await writeTextFile(metaPath, JSON.stringify(meta, null, 2));

  // Write default categories.csv. Empty `assigned` cells = null = untracked,
  // matching how parseCsv reads pre-v3 budgets.
  const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
  }));
  const categoriesCsv = unparseCsv(categories, CATEGORY_COLUMNS);
  const categoriesPath = await join(folderPath, "categories.csv");
  await writeTextFile(categoriesPath, categoriesCsv);

  // Write empty accounts.csv
  const accountsPath = await join(folderPath, "accounts.csv");
  await writeTextFile(accountsPath, ACCOUNT_COLUMNS.join(","));

  // Write empty transactions.csv
  const transactionsPath = await join(folderPath, "transactions.csv");
  await writeTextFile(transactionsPath, TRANSACTION_COLUMNS.join(","));

  return meta;
}
