/** Progress state for the Monthly Budget tab. Binary against the effective
 *  target (`assigned ?? implicitTarget`), plus a neutral state for rows that
 *  have no target at all.
 *  - `"ok"`         → spent at or under target (including exactly 100%) — green
 *  - `"over"`       → spent strictly over target — red
 *  - `"untargeted"` → no effective target (no explicit budget, no history) —
 *                     neutral/informational, never red
 *
 *  An explicit `assigned` of `0` is a real target, not the absence of one:
 *  any spend tips it into `"over"`. That falls straight out of the binary
 *  rule (`spent > 0`), so it needs no special case — but it is the reason
 *  `untargeted` keys off `assigned === null && implicitTarget === null`
 *  rather than off the effective target being zero/falsy. */
export type ProgressState = "ok" | "over" | "untargeted";

/** Effective target a category's spend is measured against: an explicit
 *  `assigned` budget when set, otherwise the derived `implicitTarget`.
 *  `null` when neither exists. */
export function effectiveTarget(
  assigned: number | null,
  implicitTarget: number | null,
): number | null {
  return assigned ?? implicitTarget;
}

export function progressState(
  spent: number,
  assigned: number | null,
  implicitTarget: number | null,
): ProgressState {
  const target = effectiveTarget(assigned, implicitTarget);
  if (target === null) return "untargeted";
  return spent > target ? "over" : "ok";
}
