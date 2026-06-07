import type { ImportTransaction, StagedRecord } from "./import-types";

/** The readable stored `description` is capped here — long enough to identify a
 *  merchant, short enough to drop trailing reference-number noise. The same cap
 *  applies to both source paths so matching is trimmed-vs-trimmed consistent. */
export const DESCRIPTION_MAX_LENGTH = 45;

export interface BuildStagedOptions {
  /** First sequential id (`imp-N`). Continues a multi-file import. Defaults to 1. */
  startId?: number;
}

/**
 * Turn intermediate {@link StagedRecord}s into staged {@link ImportTransaction}s.
 *
 * The single sink both normalization paths converge on. It owns the staging
 * invariants: sequential `imp-N` ids, the trim-45 `description`, sign
 * normalization (avoid `-0`), and empty resolved fields (merchant / accountId /
 * categoryId stay empty — those are History's and enrichment's job).
 */
export function buildStaged(
  records: StagedRecord[],
  options: BuildStagedOptions = {},
): ImportTransaction[] {
  const startId = options.startId ?? 1;
  return records.map((record, i) => ({
    id: `imp-${startId + i}`,
    date: record.date,
    description: trimDescription(record.description),
    amount: record.amount === 0 ? 0 : record.amount,
    type: record.type,
    sourceAccount: record.sourceAccount,
    sourceCategory: record.sourceCategory,
    merchant: "",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
  }));
}

function trimDescription(raw: string): string {
  return raw.trim().slice(0, DESCRIPTION_MAX_LENGTH);
}
