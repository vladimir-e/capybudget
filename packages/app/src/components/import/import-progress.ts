import {
  IMPORT_PHASE_SEGMENT,
  IMPORT_SEGMENTS,
  type ImportPhase,
  type ImportSegment,
} from "@capybudget/core";

/** The four work segments shown on the bar. `done` is the terminal state where
 *  all four read complete — it isn't a fill cell of its own. */
export const PROGRESS_SEGMENTS: readonly Exclude<ImportSegment, "done">[] =
  IMPORT_SEGMENTS.filter((s) => s !== "done") as Exclude<
    ImportSegment,
    "done"
  >[];

export const SEGMENT_LABELS: Record<
  Exclude<ImportSegment, "done">,
  string
> = {
  normalize: "Reading",
  accounts: "Accounts",
  dedup: "Duplicates",
  enrich: "Categorizing",
};

export type SegmentState = "complete" | "active" | "pending";

/**
 * Derive each work segment's state from the live phase. Phase-driven, never a
 * model-emitted percentage — so the bar is always correct.
 *
 * The active phase's segment is `active`; earlier segments are `complete`;
 * later ones `pending`. The terminal `review` phase maps to the `done` segment,
 * which sits past every work segment in fill order — so all four read
 * `complete`. That also covers the all-duplicate halt (dedup short-circuits
 * straight to `review`): enrich never runs, but the bar lands fully done rather
 * than leaving enrich pending forever.
 */
export function segmentStates(
  phase: ImportPhase,
): Record<Exclude<ImportSegment, "done">, SegmentState> {
  const activeSegment: ImportSegment | null =
    phase === "idle" ? null : IMPORT_PHASE_SEGMENT[phase];
  const activeIndex =
    activeSegment === null ? -1 : IMPORT_SEGMENTS.indexOf(activeSegment);

  const states = {} as Record<Exclude<ImportSegment, "done">, SegmentState>;
  for (const segment of PROGRESS_SEGMENTS) {
    const idx = IMPORT_SEGMENTS.indexOf(segment);
    states[segment] =
      activeIndex < 0 || idx > activeIndex
        ? "pending"
        : idx === activeIndex
          ? "active"
          : "complete";
  }
  return states;
}
