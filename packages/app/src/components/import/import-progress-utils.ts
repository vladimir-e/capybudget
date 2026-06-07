import { needsEnrich, type ImportPhase } from "@capybudget/intelligence";
import type { ImportTransaction } from "@capybudget/core";

/** The four pipeline phases with their section-bar labels, in order. The
 *  meter-bearing Categorizing phase is the last one. */
export const PROGRESS_SEGMENTS: { phase: ImportPhase; label: string }[] = [
  { phase: "reading", label: "Reading" },
  { phase: "normalizing", label: "Normalizing" },
  { phase: "history", label: "History" },
  { phase: "categorizing", label: "Categorizing" },
];

export type SegmentState = "pending" | "active" | "done";

/** Index of the active phase within the pipeline, or the segment count (all
 *  done) for a terminal `done`. `idle`/`error` sit before the bar (-1). */
export function activeIndex(phase: ImportPhase): number {
  if (phase === "done") return PROGRESS_SEGMENTS.length;
  return PROGRESS_SEGMENTS.findIndex((s) => s.phase === phase);
}

/** Phase-index state for the segment at `index` given the active phase. */
export function segmentState(index: number, phase: ImportPhase): SegmentState {
  const active = activeIndex(phase);
  if (index < active) return "done";
  if (index === active) return "active";
  return "pending";
}

/**
 * The Categorizing meter reconstructed from staged rows — for a from-disk resume
 * where the store is fresh (no live `batchProgress`) but enrichment partly ran.
 * Without it, a resumed partial import renders Categorizing full + checked while
 * the Enrich button still offers "Enrich N" — the bar contradicting reality.
 *
 * The meter is over the categorizable population (non-transfer, non-duplicate
 * rows); `done` is how many already carry a category, `total` is all of them. So
 * whenever rows still need the classifier, `done < total` and the segment reads
 * partly-filled, never falsely complete. Returns null when nothing is
 * categorizable (a fully fast-pathed / all-duplicate import), so the segment
 * falls back to its plain done state rather than faking a meter.
 */
export function resumeMeter(rows: ImportTransaction[]): { done: number; total: number } | null {
  let total = 0;
  let done = 0;
  for (const row of rows) {
    if (row.type === "transfer" || row.duplicate) continue;
    total++;
    if (!needsEnrich(row)) done++;
  }
  return total > 0 ? { done, total } : null;
}

export interface MeterView {
  /** 0–100 fill width. */
  fillPct: number;
  /** Every row landed — drives the check glyph and the done color. */
  complete: boolean;
  /** "12 of 30", or null when there's no meter to show. */
  countLabel: string | null;
}

/**
 * Resolve a segment's bar appearance. The Categorizing segment fills
 * proportionally to landed batches via `meter`; the others are binary (done =
 * full, active = full). A metered segment is `complete` only when every row
 * landed — so an interrupted run shows Categorizing partly filled, not falsely
 * checked, even though its phase index reads `done`.
 */
export function meterView(state: SegmentState, meter: { done: number; total: number } | null): MeterView {
  const hasMeter = !!meter && meter.total > 0;
  const fillPct = hasMeter
    ? Math.round((meter.done / meter.total) * 100)
    : state === "done" || state === "active"
      ? 100
      : 0;
  const complete = hasMeter ? meter.done >= meter.total : state === "done";
  const countLabel = hasMeter && state !== "pending" ? `${meter.done} of ${meter.total}` : null;
  return { fillPct, complete, countLabel };
}
