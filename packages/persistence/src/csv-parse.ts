import Papa from "papaparse";
import type { Account, Category, Transaction } from "@capybudget/core";

/** Map of field names to coercion functions for CSV -> typed object conversion */
export type CoercionMap<T> = Partial<Record<keyof T, (v: string) => unknown>>;

const toBool = (v: string) => v === "true";
const toInt = (v: string) => parseInt(v, 10);

export const ACCOUNT_COERCE: CoercionMap<Account> = { archived: toBool, sortOrder: toInt } as const;
export const CATEGORY_COERCE: CoercionMap<Category> = { archived: toBool, sortOrder: toInt } as const;
export const TRANSACTION_COERCE: CoercionMap<Transaction> = { amount: toInt } as const;

/** Parse CSV content and coerce fields to their typed values. */
export function parseCsv<T>(content: string, coerce: CoercionMap<T>): T[] {
  const { data } = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  return data.map((row) => {
    const typed = { ...row } as Record<string, unknown>;
    for (const [key, fn] of Object.entries(coerce)) {
      if (key in typed) {
        typed[key] = (fn as (v: string) => unknown)(row[key]);
      }
    }
    return typed as T;
  });
}

/** Serialize data to CSV string. */
export function unparseCsv(data: unknown[]): string {
  return Papa.unparse(data);
}
