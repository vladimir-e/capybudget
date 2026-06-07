/**
 * Pre-indexed history for grounding's fuzzy matcher.
 *
 * History (6+ years, thousands of transactions) is indexed once per run. Each
 * historical transaction contributes up to two candidates: its cleaned
 * `merchant` and its prior `note` (the trimmed description carried at merge).
 * Both are canonicalized through the same key as new rows.
 *
 * Candidate retrieval is inverted-index driven (token + trigram → candidates),
 * so scoring touches only candidates that share signal with the query, not the
 * whole corpus. Ranking then scores by combined token / trigram similarity.
 */

import type { Transaction } from "../entities/types";
import { canonicalizeMatchKey, tokenize, trigrams } from "./import-canonicalize";

export type MatchSource = "merchant" | "note";

interface Candidate {
  txn: Transaction;
  source: MatchSource;
  key: string;
  tokens: Set<string>;
  trigrams: Set<string>;
}

export interface HistoryMatch {
  txn: Transaction;
  /** Which field matched — `merchant` ranks above `note` at equal score. */
  source: MatchSource;
  /** Combined similarity in [0, 1]. */
  score: number;
}

/** A query carrying its precomputed features, so a row is canonicalized once. */
export interface MatchQuery {
  key: string;
  tokens: Set<string>;
  trigrams: Set<string>;
}

export interface HistoryIndexOptions {
  /** Minimum combined similarity to count as a match. Defaults to 0.5. */
  minScore?: number;
}

const DEFAULT_MIN_SCORE = 0.5;

/** Build a query from a row's (already trimmed) description. */
export function buildMatchQuery(description: string): MatchQuery {
  const key = canonicalizeMatchKey(description);
  return {
    key,
    tokens: new Set(tokenize(key)),
    trigrams: new Set(trigrams(key)),
  };
}

export class HistoryIndex {
  private readonly candidates: Candidate[] = [];
  private readonly byToken = new Map<string, Set<number>>();
  private readonly byTrigram = new Map<string, Set<number>>();
  private readonly minScore: number;

  constructor(history: Transaction[], options: HistoryIndexOptions = {}) {
    this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    for (const txn of history) {
      this.addCandidate(txn, txn.merchant, "merchant");
      this.addCandidate(txn, txn.note, "note");
    }
  }

  private addCandidate(txn: Transaction, raw: string, source: MatchSource): void {
    if (!raw || !raw.trim()) return;
    const key = canonicalizeMatchKey(raw);
    if (!key) return;
    const tokens = new Set(tokenize(key));
    const tris = new Set(trigrams(key));
    if (tokens.size === 0 && tris.size === 0) return;

    const idx = this.candidates.length;
    this.candidates.push({ txn, source, key, tokens, trigrams: tris });
    for (const t of tokens) addToBucket(this.byToken, t, idx);
    for (const g of tris) addToBucket(this.byTrigram, g, idx);
  }

  /**
   * Ranked historical matches for a query, best first.
   *
   * A historical transaction is one match — not one per field it hits. When a
   * txn matches via both its merchant and its note, only its best-scoring
   * (merchant-preferred) candidate is kept, so it counts once toward fast-path
   * thresholds and stats.
   */
  match(query: MatchQuery): HistoryMatch[] {
    const candidateIdxs = new Set<number>();
    for (const t of query.tokens) {
      const bucket = this.byToken.get(t);
      if (bucket) for (const i of bucket) candidateIdxs.add(i);
    }
    for (const g of query.trigrams) {
      const bucket = this.byTrigram.get(g);
      if (bucket) for (const i of bucket) candidateIdxs.add(i);
    }

    const bestByTxn = new Map<string, HistoryMatch>();
    for (const i of candidateIdxs) {
      const cand = this.candidates[i];
      const score = similarity(query, cand);
      if (score < this.minScore) continue;
      const match: HistoryMatch = { txn: cand.txn, source: cand.source, score };
      const prior = bestByTxn.get(cand.txn.id);
      if (!prior || rankMatches(match, prior) < 0) {
        bestByTxn.set(cand.txn.id, match);
      }
    }

    const matches = [...bestByTxn.values()];
    matches.sort(rankMatches);
    return matches;
  }
}

function similarity(query: MatchQuery, cand: Candidate): number {
  if (query.key === cand.key) return 1;
  const tokenSim = jaccard(query.tokens, cand.tokens);
  const triSim = dice(query.trigrams, cand.trigrams);

  // Single-token queries sit right at the 0.5 boundary (`uber` vs `uber eats`),
  // where trigram-only overlap can coincidentally clear threshold against an
  // unrelated longer merchant. Require the lone token to actually appear as a
  // whole token in the candidate before trusting the trigram channel — this
  // tightens precision without lowering recall on the real same-vendor case
  // (the token IS present there). Known precision/recall tradeoff lives here.
  if (query.tokens.size === 1) {
    const [only] = query.tokens;
    if (!cand.tokens.has(only)) return tokenSim;
  }

  // Token overlap is the stronger signal (whole-word merchant identity);
  // trigrams rescue near-spellings and concatenations. Take the max so either
  // channel can carry a confident match on its own.
  return Math.max(tokenSim, triSim);
}

function rankMatches(a: HistoryMatch, b: HistoryMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  // Merchant (cleaned canonical form) wins ties over note.
  if (a.source !== b.source) return a.source === "merchant" ? -1 : 1;
  // Then most-recent first.
  return b.txn.datetime.localeCompare(a.txn.datetime);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function addToBucket(map: Map<string, Set<number>>, key: string, idx: number): void {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = new Set();
    map.set(key, bucket);
  }
  bucket.add(idx);
}
