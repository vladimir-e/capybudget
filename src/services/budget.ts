import { exists, readTextFile, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BudgetMeta, Category } from "@/lib/types";
import Papa from "papaparse";

const SCHEMA_VERSION = 1;
const BUDGET_FILE = "budget.json";

const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Paycheck", group: "Income", assigned: 0, sortOrder: 0 },
  { name: "Other Income", group: "Income", assigned: 0, sortOrder: 1 },
  { name: "Housing", group: "Fixed", assigned: 0, sortOrder: 0 },
  { name: "Bills & Utilities", group: "Fixed", assigned: 0, sortOrder: 1 },
  { name: "Subscriptions", group: "Fixed", assigned: 0, sortOrder: 2 },
  { name: "Groceries", group: "Daily Living", assigned: 0, sortOrder: 0 },
  { name: "Dining Out", group: "Daily Living", assigned: 0, sortOrder: 1 },
  { name: "Transportation", group: "Daily Living", assigned: 0, sortOrder: 2 },
  { name: "Alcohol & Smoking", group: "Personal", assigned: 0, sortOrder: 0 },
  { name: "Health & Beauty", group: "Personal", assigned: 0, sortOrder: 1 },
  { name: "Clothing", group: "Personal", assigned: 0, sortOrder: 2 },
  { name: "Fun & Hobbies", group: "Personal", assigned: 0, sortOrder: 3 },
  { name: "Allowances", group: "Personal", assigned: 0, sortOrder: 4 },
  { name: "Education & Business", group: "Personal", assigned: 0, sortOrder: 5 },
  { name: "Gifts & Giving", group: "Personal", assigned: 0, sortOrder: 6 },
  { name: "Housekeeping & Maintenance", group: "Irregular", assigned: 0, sortOrder: 0 },
  { name: "Big Purchases", group: "Irregular", assigned: 0, sortOrder: 1 },
  { name: "Travel", group: "Irregular", assigned: 0, sortOrder: 2 },
  { name: "Taxes & Fees", group: "Irregular", assigned: 0, sortOrder: 3 },
];

export async function detectBudget(folderPath: string): Promise<BudgetMeta | null> {
  const metaPath = await join(folderPath, BUDGET_FILE);
  const fileExists = await exists(metaPath);
  if (!fileExists) return null;

  const raw = await readTextFile(metaPath);
  return JSON.parse(raw) as BudgetMeta;
}

export async function bootstrapBudget(folderPath: string, name: string): Promise<BudgetMeta> {
  const now = new Date().toISOString();
  const meta: BudgetMeta = {
    schemaVersion: SCHEMA_VERSION,
    name,
    createdAt: now,
    lastModified: now,
  };

  // Ensure directory exists
  await mkdir(folderPath, { recursive: true }).catch(() => {});

  // Write budget.json
  const metaPath = await join(folderPath, BUDGET_FILE);
  await writeTextFile(metaPath, JSON.stringify(meta, null, 2));

  // Write default categories.csv
  const categories: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({
    ...c,
    id: i + 1,
  }));
  const categoriesCsv = Papa.unparse(categories);
  const categoriesPath = await join(folderPath, "categories.csv");
  await writeTextFile(categoriesPath, categoriesCsv);

  // Write empty accounts.csv
  const accountsPath = await join(folderPath, "accounts.csv");
  await writeTextFile(accountsPath, "id,name,type,startBalance,sortOrder,createdAt");

  // Write empty transactions.csv
  const transactionsPath = await join(folderPath, "transactions.csv");
  await writeTextFile(transactionsPath, "id,date,type,amount,categoryId,accountId,toAccountId,note,createdAt");

  return meta;
}
