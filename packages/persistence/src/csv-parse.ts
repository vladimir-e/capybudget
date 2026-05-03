import Papa from "papaparse";
import type { Account, Category, Transaction } from "@capybudget/core";

/** Coerce a raw CSV cell (possibly missing) into its typed value.
 *  Receiving `undefined` means the column was absent — return a sensible default. */
export type Coerce = (v: string | undefined) => unknown;

/** Map of field names to coercion functions for CSV -> typed object conversion.
 *  Every key in the map is set on the parsed object, even when the source column is
 *  absent — that's how new fields get their default for older CSVs. */
export type CoercionMap<T> = Partial<Record<keyof T, Coerce>>;

const toBool: Coerce = (v) => v === "true";
const toInt: Coerce = (v) => (v === undefined || v === "" ? 0 : parseInt(v, 10));

export const ACCOUNT_COERCE: CoercionMap<Account> = {
  archived: toBool,
  excludeFromNetWorth: toBool,
  sortOrder: toInt,
} as const;
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
      typed[key] = (fn as Coerce)(row[key]);
    }
    return typed as T;
  });
}

/** Serialize data to CSV string. */
export function unparseCsv(data: unknown[]): string {
  return Papa.unparse(data);
}
