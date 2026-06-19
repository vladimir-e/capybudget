import { needsEnrich, needsTransferEnrich, type ImportPhase } from "@capybudget/intelligence";
import type { ImportTransaction } from "@capybudget/core";

/**
 * The section bar's two segments, each covering a span of internal pipeline
 * phases. The pipeline keeps its four-phase vocabulary (reading → normalizing
 * → history → categorizing); the bar presents it as two strokes of work:
 * **Normalizing** (load + the mapping/extraction model call) and **Enhancing**
 * (grounding + the classifier batches). The meter-bearing Enhancing segment is
 * the last one.
 */
export const PROGRESS_SEGMENTS: {
  key: "normalizing" | "enhancing";
  phases: readonly ImportPhase[];
}[] = [
  { key: "normalizing", phases: ["reading", "normalizing"] },
  { key: "enhancing", phases: ["history", "categorizing"] },
];

export type SegmentState = "pending" | "active" | "done";

/** Index of the segment covering the active phase, or the segment count (all
 *  done) for a terminal `done`. `idle`/`error` sit before the bar (-1). */
export function activeIndex(phase: ImportPhase): number {
  if (phase === "done") return PROGRESS_SEGMENTS.length;
  return PROGRESS_SEGMENTS.findIndex((s) => s.phases.includes(phase));
}

/** Phase-index state for the segment at `index` given the active phase. */
export function segmentState(index: number, phase: ImportPhase): SegmentState {
  const active = activeIndex(phase);
  if (index < active) return "done";
  if (index === active) return "active";
  return "pending";
}

/** A segment's meter: `done` of `total`, with a null total for a counter whose
 *  denominator isn't known yet (an extraction before the model declares its
 *  count). The Normalizing meter maps `rows → done`; Categorizing is exact. */
export interface SegmentMeter {
  done: number;
  total: number | null;
}

/**
 * The Enhancing meter reconstructed from staged rows — for a from-disk resume
 * where the store is fresh (no live `batchProgress`) but enrichment partly ran.
 * Without it, a resumed partial import renders Enhancing full + checked while
 * the Enrich button still offers "Enrich N" — the bar contradicting reality.
 *
 * The meter mirrors the orchestrator's `pendingCategory + pendingTransfer` total:
 * income/expense rows enrich against `needsEnrich`, and a transfer counts only
 * when it carries transfer context (its id in `transferCtxIds`) — a contextless
 * transfer can't be auto-resolved, so it never inflates the denominator. `done`
 * is the rows that no longer need enrich; whenever any remain, `done < total` and
 * the segment reads partly-filled, never falsely complete. Returns null when
 * nothing is categorizable (a fully fast-pathed / all-duplicate import), so the
 * segment falls back to its plain done state rather than faking a meter.
 */
export function resumeMeter(
  rows: ImportTransaction[],
  transferCtxIds: Set<string>,
): { done: number; total: number } | null {
  let total = 0;
  let done = 0;
  for (const row of rows) {
    if (row.duplicate) continue;
    if (row.type === "transfer") {
      // In-population iff context-bearing (a resolved one stays counted so the
      // denominator is stable as counterparts land); done once the counterpart is
      // set. Contextless transfers can't be auto-resolved — they never count.
      if (!transferCtxIds.has(row.id)) continue;
      total++;
      if (!needsTransferEnrich(row, true)) done++;
      continue;
    }
    total++;
    if (!needsEnrich(row)) done++;
  }
  return total > 0 ? { done, total } : null;
}

/** The count to render next to a segment: a proportional "done of total", a
 *  bare row count while the denominator is unknown, or nothing. The component
 *  turns this into a localized label. */
export type MeterCount =
  | { kind: "of"; done: number; total: number }
  | { kind: "rows"; done: number }
  | null;

export interface MeterView {
  /** 0–100 fill width. */
  fillPct: number;
  /** Every row landed — drives the check glyph and the done color. */
  complete: boolean;
  /** The metered count, or null when there's nothing to show. */
  count: MeterCount;
}

/**
 * Resolve a segment's bar appearance. A metered segment fills proportionally
 * (clamped — totals can be estimates) and is `complete` only when every row
 * landed AND the segment's phase has moved past it — a full meter on the
 * active segment is a between-steps moment (next file, next batch), not the
 * segment finishing, so it never flashes the check early. An interrupted run
 * shows Enhancing partly filled, not falsely checked, even though its phase
 * index reads `done`. A meter with a null total counts without filling — the
 * segment keeps its binary fill and shows the live row count. Meter-less
 * segments are binary (done = full, active = full).
 */
export function meterView(state: SegmentState, meter: SegmentMeter | null): MeterView {
  const binary = {
    fillPct: state === "done" || state === "active" ? 100 : 0,
    complete: state === "done",
  };
  if (!meter || meter.total === null || meter.total <= 0) {
    const counting = !!meter && state !== "pending" && meter.done > 0;
    return { ...binary, count: counting ? { kind: "rows", done: meter.done } : null };
  }
  return {
    fillPct: Math.min(100, Math.round((meter.done / meter.total) * 100)),
    complete: meter.done >= meter.total && state !== "active",
    count: state !== "pending" ? { kind: "of", done: meter.done, total: meter.total } : null,
  };
}
