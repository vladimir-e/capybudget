import type { BudgetRow } from "./monthly-budget-rows";
import { effectiveTarget, progressState, type ProgressState } from "./monthly-budget-progress";

/** Fraction of the track width at which the target divider sits — fixed
 *  across every row so the divider forms a straight vertical line down the
 *  whole column. Everything left of it is the green zone (0 → target),
 *  everything right is the red over-zone (target → over-max). */
export const TARGET_FRACTION = 0.7;

/** Width of the over-zone (1 − TARGET_FRACTION), where overspend is shown. */
export const OVER_ZONE = 1 - TARGET_FRACTION;

/** Overshoot compression. A value of `target` lands exactly on the divider;
 *  beyond that, `overshoot = value / target − 1` is log-compressed into the
 *  over-zone so an extreme overspend can't blow out the layout. Tuned so 2×
 *  the target reaches the middle of the red zone and ~4×+ saturates just shy
 *  of the right edge (CAP keeps it inside OVER_ZONE, never on the very edge). */
const OVER_K = 0.15;
const OVER_CAP = 0.28;

export interface BarPin {
  /** Abs cents this pin represents. */
  value: number;
  /** Position along the track, 0..1, on the same scale as the fill. */
  fraction: number;
  kind: "lastMonth" | "avg3Month";
}

export interface BarGeometry {
  state: ProgressState;
  /** True when the divider is the auto-derived implicit target rather than a
   *  user-set budget — drives the dashed/ghosted divider + "auto" treatment. */
  isImplicit: boolean;
  /** Divider position, 0..1. `null` for the untargeted state (no divider). */
  targetFraction: number | null;
  /** Spend fill width, 0..1. */
  fillFraction: number;
  /** Reference markers, ordered low→high. Empty when there's no scale to
   *  place them on (untargeted, or an explicit zero target). */
  pins: BarPin[];
}

/** Map an abs-cents value onto the track, where `target` lands on the divider.
 *  Below/at target: linear into the green zone. Above: log-compressed into the
 *  over-zone. Assumes `target > 0` (callers handle the zero/null cases). */
function project(value: number, target: number): number {
  if (value <= target) {
    return (value / target) * TARGET_FRACTION;
  }
  const overshoot = value / target - 1;
  const over = Math.min(Math.log2(1 + overshoot) * OVER_K, OVER_CAP);
  return TARGET_FRACTION + over;
}

/** Pure geometry for the zoned budget bar. The JSX renderer is a thin shell
 *  over this — all position/scale logic lives here so it can be unit-tested
 *  without a DOM. Each row carries its own scale (its target maps to the
 *  shared divider fraction), which is what lets the user scan the column and
 *  read "over vs under" off divider-crossing alone, regardless of dollar size. */
export function barGeometry(row: BudgetRow): BarGeometry {
  const target = effectiveTarget(row.assigned, row.implicitTarget);
  const state = progressState(row.spent, row.assigned, row.implicitTarget);

  // No target at all — a calm informational bar. The fill only signals
  // "there is spend here", since without a target there's nothing to scale
  // against and nothing to be over.
  if (target === null) {
    return {
      state,
      isImplicit: false,
      targetFraction: null,
      fillFraction: row.spent > 0 ? 1 : 0,
      pins: [],
    };
  }

  // Explicit zero budget ("don't spend here"): the green zone has no width, so
  // the divider sits at the left edge and any spend reads as a full over-bar.
  // Historical pins can't be scaled against a zero target, so omit them.
  if (target <= 0) {
    return {
      state,
      isImplicit: row.isImplicit,
      targetFraction: 0,
      fillFraction: row.spent > 0 ? TARGET_FRACTION + OVER_CAP : 0,
      pins: [],
    };
  }

  const pins: BarPin[] = [];
  if (row.lastMonth > 0) {
    pins.push({ value: row.lastMonth, fraction: project(row.lastMonth, target), kind: "lastMonth" });
  }
  if (row.avg3Month > 0) {
    pins.push({ value: row.avg3Month, fraction: project(row.avg3Month, target), kind: "avg3Month" });
  }
  pins.sort((a, b) => a.fraction - b.fraction);

  return {
    state,
    isImplicit: row.isImplicit,
    targetFraction: TARGET_FRACTION,
    fillFraction: project(row.spent, target),
    pins,
  };
}
