import { readTextFile, writeTextFile, rename } from "@tauri-apps/plugin-fs";
import Papa from "papaparse";

/** Map of field names to coercion functions for CSV → typed object conversion */
export type CoercionMap<T> = Partial<Record<keyof T, (v: string) => unknown>>;

const toBool = (v: string) => v === "true";
const toInt = (v: string) => parseInt(v, 10);

export const ACCOUNT_COERCE = { archived: toBool, sortOrder: toInt } as const;
export const CATEGORY_COERCE = { archived: toBool, sortOrder: toInt } as const;
export const TRANSACTION_COERCE = { amount: toInt } as const;

/** Read a CSV file and coerce fields to their typed values. */
export async function readCsv<T>(
  filePath: string,
  coerce: CoercionMap<T>,
): Promise<T[]> {
  const raw = await readTextFile(filePath);
  const { data } = Papa.parse<Record<string, string>>(raw, {
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

/** Write data to a CSV file atomically (write .tmp then rename). */
export async function writeCsvAtomic(
  filePath: string,
  data: unknown[],
): Promise<void> {
  const csv = Papa.unparse(data);
  const tmpPath = `${filePath}.tmp`;
  await writeTextFile(tmpPath, csv);
  await rename(tmpPath, filePath);
}

/** Create a debounced writer that batches rapid calls. */
export function createDebouncedWriter(
  fn: () => Promise<void>,
  delayMs = 300,
): { schedule(): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) await pending;
    pending = fn();
    await pending;
    pending = null;
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pending = fn().finally(() => {
        pending = null;
      });
    }, delayMs);
  };

  return { schedule, flush };
}
