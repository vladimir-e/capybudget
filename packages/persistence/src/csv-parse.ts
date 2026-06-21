import Papa from "papaparse";
import type { Account, Category, Transaction } from "@capybudget/core";

/** Coerce a raw CSV cell (possibly missing) into its typed value.
 *  Receiving `undefined` means the column was absent — return a sensible default. */
export type Coerce = (v: string | undefined) => unknown;

/** Map of field names to coercion functions for CSV -> typed object conversion.
 *  Every key in the map is set on the parsed object, even when the source column is
 *  absent — that's how new fields get their default for older CSVs. */
export type CoercionMap<T> = Partial<Record<keyof T, Coerce>>;

/** The keys an entity must persist: its required fields. Optional fields are
 *  not-yet-persisted by design — a field gets a column only once it's stored on
 *  disk, which the migration that introduces it decides. */
type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

/** Build a readonly column tuple for T. Compile error if a key is unknown or a
 *  required field is missing — adding a stored field to the model forces a
 *  column-order decision here. Optional fields may be listed or omitted. */
function columns<T>() {
  return <const C extends readonly (keyof T)[]>(
    cols: C & ([Exclude<RequiredKeys<T>, C[number]>] extends [never] ? unknown : never),
  ): C => cols;
}

/** Canonical CSV column order — the single source of truth for every writer. */
export const ACCOUNT_COLUMNS = columns<Account>()([
  "id",
  "name",
  "type",
  "archived",
  "excludeFromNetWorth",
  "sortOrder",
  "createdAt",
  "currency",
]);
export const CATEGORY_COLUMNS = columns<Category>()([
  "id",
  "name",
  "group",
  "archived",
  "sortOrder",
  "assigned",
]);
export const TRANSACTION_COLUMNS = columns<Transaction>()([
  "id",
  "datetime",
  "type",
  "amount",
  "categoryId",
  "accountId",
  "transferPairId",
  "merchant",
  "note",
  "createdAt",
  "fxRate",
]);

const toBool: Coerce = (v) => v === "true";
const toInt: Coerce = (v) => (v === undefined || v === "" ? 0 : parseInt(v, 10));
/** Tracked-or-not integer: `null` for missing/empty, otherwise parsed int.
 *  Used for {@link Category.assigned} (monthly budget target in cents). */
const toNullableInt: Coerce = (v) =>
  v === undefined || v === "" ? null : parseInt(v, 10);
/** Optional float: `undefined` for missing/empty, otherwise parsed.
 *  Used for {@link Transaction.fxRate} (empty = default currency = 1.0). */
const toOptionalFloat: Coerce = (v) =>
  v === undefined || v === "" ? undefined : parseFloat(v);

export const ACCOUNT_COERCE: CoercionMap<Account> = {
  archived: toBool,
  excludeFromNetWorth: toBool,
  sortOrder: toInt,
} as const;
export const CATEGORY_COERCE: CoercionMap<Category> = {
  archived: toBool,
  sortOrder: toInt,
  assigned: toNullableInt,
} as const;
export const TRANSACTION_COERCE: CoercionMap<Transaction> = {
  amount: toInt,
  fxRate: toOptionalFloat,
} as const;

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

/** Serialize data to CSV with an explicit column order, so output never
 *  depends on object key order. */
export function unparseCsv(data: unknown[], columns: readonly string[]): string {
  return Papa.unparse(data, { columns: [...columns] });
}
