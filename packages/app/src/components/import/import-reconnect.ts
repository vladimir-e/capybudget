/**
 * Decide what the import screen should do on mount when the store is idle but
 * disk may hold an in-progress import.
 *
 * The store-owned `enriched` flag distinguishes a finished run from one that
 * died after normalize wrote the CSV but before the run completed. Resuming is
 * gated strictly on `enriched === false` so a completed run never re-runs.
 *
 * A resume re-runs the *full* post-normalize pipeline (accounts → dedup →
 * enrich) over the staging CSV — not enrich alone. An interrupted run may have
 * died before or during account mapping or dedup, so finishing with enrich-only
 * would skip those phases and reach preview unmapped.
 */
export type ReconnectAction =
  | { kind: "empty" }         // no CSV — fall back to drop zone / file list
  | { kind: "review" }        // finished run — land on the preview
  | { kind: "resume-run" };   // interrupted run — re-run the post-normalize pipeline

export function resolveReconnect(
  hasCsv: boolean,
  enriched: boolean,
): ReconnectAction {
  if (!hasCsv) return { kind: "empty" };
  return enriched ? { kind: "review" } : { kind: "resume-run" };
}
