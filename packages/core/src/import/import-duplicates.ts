import type { Transaction } from "../entities/types";
import type { ImportTransaction } from "./import-types";

export type DuplicateConfidence = "high" | "low";

/** Rule-5 relaxed window: how many days on each side of the import date to scan
 *  for an amount+account match when the description doesn't line up. Wide enough
 *  to catch a cross-statement transfer leg whose two accounts post a few days
 *  apart, narrow enough that two unrelated same-amount charges in the same
 *  account don't collide. */
export const RELAXED_DATE_WINDOW_DAYS = 3;

export interface DuplicateMatch {
  confidence: DuplicateConfidence;
  existingTransactionId: string;
  matchedDate: string;
  matchedAmount: number;
  /** The matched transaction's merchant — carried so a deduped row can show
   *  what it duplicates without re-querying. */
  matchedMerchant: string;
  /** The matched transaction's categoryId — carried for the same reason. */
  matchedCategoryId: string;
}

/**
 * Detect import transactions that likely already exist in the budget.
 *
 * Matching rules (checked in order, first match wins):
 * 1. High — date + amount + same resolved merchant + same resolved account
 * 2. High — date + amount + description (non-empty) + same resolved account
 * 3. High — date + amount + description (non-empty), no account info on import side
 * 4. Low  — date + amount + same resolved account (description empty or different)
 * 5. Low  — date ±RELAXED_DATE_WINDOW_DAYS + amount + same resolved account
 *
 * Claiming is greedy 1:1 but runs in two passes sharing one claimed set: every
 * row tries the high-confidence rules (1-3) before any row may claim through
 * the relaxed rules (4-5). Otherwise a row earlier in file order could claim
 * via the ±day window an existing transaction that a later row matches exactly
 * — one stolen claim producing both a false duplicate and a missed one.
 *
 * Account resolution uses accountMapping (sourceAccount → accountId). Merchant
 * resolution comes from grounding via the optional `resolveMerchant` accessor —
 * a fast-pathed row carries a canonical merchant that nails the dup even when
 * the raw descriptions diverge.
 */
export function detectDuplicates(
  importTxns: ImportTransaction[],
  existingTxns: Transaction[],
  accountMapping: Record<string, string>,
  resolveMerchant?: (imp: ImportTransaction) => string,
): Map<string, DuplicateMatch> {
  const result = new Map<string, DuplicateMatch>();
  if (existingTxns.length === 0) return result;

  // Pre-index existing transactions by date string (YYYY-MM-DD) for fast lookup
  const byDate = new Map<string, Transaction[]>();
  for (const txn of existingTxns) {
    const date = txn.datetime.slice(0, 10);
    let list = byDate.get(date);
    if (!list) {
      list = [];
      byDate.set(date, list);
    }
    list.push(txn);
  }

  // Track which existing transactions have already been matched (greedy 1:1)
  const claimed = new Set<string>();

  const runPass = (findForRow: (imp: ImportTransaction) => DuplicateMatch | null): void => {
    for (const imp of importTxns) {
      if (result.has(imp.id)) continue;
      const match = findForRow(imp);
      if (!match) continue;
      claimed.add(match.existingTransactionId);
      result.set(imp.id, match);
    }
  };

  // Pass 1: high-confidence rules (1-3) for every row.
  runPass((imp) => {
    const resolvedAccount = resolveAccount(imp, accountMapping);
    const hasAccount = resolvedAccount !== "";
    const hasDescription = imp.description.trim() !== "";
    const resolvedMerchant = (resolveMerchant?.(imp) ?? imp.merchant).trim();
    const exactCandidates = byDate.get(imp.date) ?? [];

    // Rule 1: High — date + amount + resolved merchant + same account
    if (resolvedMerchant !== "" && hasAccount) {
      const match = findMatch(exactCandidates, claimed, imp.amount, "high", (ex) =>
        ex.accountId === resolvedAccount &&
        ex.merchant.trim().toLowerCase() === resolvedMerchant.toLowerCase(),
      );
      if (match) return match;
    }

    // Rule 2: High — date + amount + description + same account
    if (hasDescription && hasAccount) {
      const match = findMatch(exactCandidates, claimed, imp.amount, "high", (ex) =>
        ex.accountId === resolvedAccount && matchDescription(imp.description, ex),
      );
      if (match) return match;
    }

    // Rule 3: High — date + amount + description, no account on import side
    if (hasDescription && !hasAccount) {
      return findMatch(exactCandidates, claimed, imp.amount, "high", (ex) =>
        matchDescription(imp.description, ex),
      );
    }

    return null;
  });

  // Pass 2: relaxed rules (4-5) for the rows still unmatched.
  runPass((imp) => {
    const resolvedAccount = resolveAccount(imp, accountMapping);
    if (resolvedAccount === "") return null;
    const sameAccount = (ex: Transaction): boolean => ex.accountId === resolvedAccount;

    // Rule 4: Low — date + amount + same account (no description match)
    const match = findMatch(byDate.get(imp.date) ?? [], claimed, imp.amount, "low", sameAccount);
    if (match) return match;

    // Rule 5: Low — date ±RELAXED_DATE_WINDOW_DAYS + amount + same account.
    // Neighbors are ordered closest day first, so rule 5 prefers the nearest match.
    return findMatch(relaxedNeighbors(imp.date, byDate), claimed, imp.amount, "low", sameAccount);
  });

  return result;
}

function resolveAccount(
  imp: ImportTransaction,
  accountMapping: Record<string, string>,
): string {
  if (imp.sourceAccount) {
    const mapped = accountMapping[imp.sourceAccount];
    if (mapped && mapped !== "__create__") return mapped;
  }
  return imp.accountId || "";
}

function matchDescription(importDesc: string, existing: Transaction): boolean {
  return existing.note.toLowerCase().includes(importDesc.toLowerCase());
}

function findMatch(
  candidates: Transaction[],
  claimed: Set<string>,
  amount: number,
  confidence: DuplicateConfidence,
  predicate: (ex: Transaction) => boolean,
): DuplicateMatch | null {
  for (const ex of candidates) {
    if (claimed.has(ex.id)) continue;
    if (ex.amount !== amount) continue;
    if (!predicate(ex)) continue;
    return {
      confidence,
      existingTransactionId: ex.id,
      matchedDate: ex.datetime.slice(0, 10),
      matchedAmount: ex.amount,
      matchedMerchant: ex.merchant,
      matchedCategoryId: ex.categoryId,
    };
  }
  return null;
}

/** Existing transactions within ±RELAXED_DATE_WINDOW_DAYS of `date`, excluding
 *  the exact day (rules 1-4 own that), ordered by increasing day-distance so a
 *  greedy claim takes the closest candidate first. Within one day-distance the
 *  earlier (negative) offset comes first. */
function relaxedNeighbors(
  date: string,
  byDate: Map<string, Transaction[]>,
): Transaction[] {
  const neighbors: Transaction[] = [];
  for (let d = 1; d <= RELAXED_DATE_WINDOW_DAYS; d++) {
    neighbors.push(...(byDate.get(offsetDate(date, -d)) ?? []));
    neighbors.push(...(byDate.get(offsetDate(date, d)) ?? []));
  }
  return neighbors;
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
