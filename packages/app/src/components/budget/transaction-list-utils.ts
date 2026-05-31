import type { SortColumn, SortConfig } from "@/lib/filter-transactions";

export function formatDate(iso: string): string {
  const datePart = iso.slice(0, 10);
  return new Date(datePart + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function defaultDirection(column: SortColumn): SortConfig["direction"] {
  return column === "date" ? "desc" : "asc";
}

/** Row count threshold: below this, render directly; above, virtualize. */
export const VIRTUALIZE_THRESHOLD = 100;
export const ROW_HEIGHT_ESTIMATE = 41;
