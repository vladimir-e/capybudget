import type { SortColumn, SortConfig } from "@/lib/filter-transactions";

export function defaultDirection(column: SortColumn): SortConfig["direction"] {
  return column === "date" ? "desc" : "asc";
}

/** Row count threshold: below this, render directly; above, virtualize. */
export const VIRTUALIZE_THRESHOLD = 100;
export const ROW_HEIGHT_ESTIMATE = 41;
