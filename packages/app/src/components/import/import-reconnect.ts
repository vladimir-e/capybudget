/**
 * Decide what the import screen should do on mount when the store is idle but
 * disk may hold an in-progress import.
 *
 * The store-owned `enriched` flag distinguishes a finished run from one that
 * died after normalize wrote the CSV but before enrich completed. Resuming is
 * gated strictly on `enriched === false` so a completed run never re-enriches.
 */
export type ReconnectAction =
  | { kind: "empty" }            // no CSV — fall back to drop zone / file list
  | { kind: "review" }           // finished run — land on the preview
  | { kind: "resume-enrich" };   // interrupted run — finish the enrich phase

export function resolveReconnect(
  hasCsv: boolean,
  enriched: boolean,
): ReconnectAction {
  if (!hasCsv) return { kind: "empty" };
  return enriched ? { kind: "review" } : { kind: "resume-enrich" };
}
