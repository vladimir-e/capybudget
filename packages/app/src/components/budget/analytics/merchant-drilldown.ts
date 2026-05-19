import { normalizeMerchant } from "@/lib/filter-transactions";

/** A click target for the merchant drilldown. The `kind` discriminator
 *  separates the synthetic empty-merchant bucket from any named merchant —
 *  including a legitimate merchant literally named "Unknown" — which
 *  collide if you route by display string. */
export type MerchantDrilldownTarget =
  | { kind: "unknown" }
  | { kind: "merchant"; value: string };

/** Build the drilldown target for a `MerchantSpending`-shaped row. The
 *  source of truth is the row's own `isUnknown` flag (from
 *  `getTopMerchants`), never the display name. */
export function targetForRow(row: { merchant: string; isUnknown: boolean }): MerchantDrilldownTarget {
  return row.isUnknown ? { kind: "unknown" } : { kind: "merchant", value: row.merchant };
}

/** Test whether a transaction's merchant matches the drilldown target.
 *  Uses the same normalized-key equality as `getTopMerchants`. */
export function matchesTarget(merchant: string, target: MerchantDrilldownTarget): boolean {
  const norm = normalizeMerchant(merchant);
  if (target.kind === "unknown") return norm === "";
  return norm === normalizeMerchant(target.value);
}
