/** Progress state for the Monthly Budget tab.
 *  - `null`     → category is untracked (no assigned target)
 *  - `"ok"`     → spent comfortably under target (ratio < 0.8)
 *  - `"warn"`   → at or near the target (ratio in [0.8, 1.0])
 *  - `"over"`   → exceeded the target (ratio > 1, or any spend on a tracked-zero)
 *
 *  Tracked-zero (`assigned === 0`) is a real state — the category is
 *  intentionally budgeted at $0, so any spend tips it into "over". */
export type ProgressState = "ok" | "warn" | "over";

export function progressState(
  spent: number,
  assigned: number | null,
): ProgressState | null {
  if (assigned === null) return null; // untracked
  if (assigned === 0) return spent > 0 ? "over" : "ok";
  const ratio = spent / assigned;
  if (ratio > 1) return "over";
  if (ratio >= 0.8) return "warn";
  return "ok";
}
