import type { Transaction } from "../entities/types";
import type { ImportTransaction } from "./import-types";

export type DuplicateConfidence = "high" | "low";

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
 * 5. Low  — date ±1 day + amount + same resolved account
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

  for (const imp of importTxns) {
    const resolvedAccount = resolveAccount(imp, accountMapping);
    const hasAccount = resolvedAccount !== "";
    const hasDescription = imp.description.trim() !== "";
    const resolvedMerchant = (resolveMerchant?.(imp) ?? imp.merchant).trim();
    const hasMerchant = resolvedMerchant !== "";

    // Collect candidate dates: exact date + ±1 day neighbors
    const exactCandidates = byDate.get(imp.date) ?? [];
    const prevDay = offsetDate(imp.date, -1);
    const nextDay = offsetDate(imp.date, 1);
    const prevCandidates = byDate.get(prevDay) ?? [];
    const nextCandidates = byDate.get(nextDay) ?? [];

    let match: DuplicateMatch | null = null;

    // Rule 1: High — date + amount + resolved merchant + same account
    if (hasMerchant && hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount &&
        ex.merchant.trim().toLowerCase() === resolvedMerchant.toLowerCase(),
      );
      if (match) { match.confidence = "high"; }
    }

    // Rule 2: High — date + amount + description + same account
    if (!match && hasDescription && hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount && matchDescription(imp.description, ex),
      );
      if (match) { match.confidence = "high"; }
    }

    // Rule 3: High — date + amount + description, no account on import side
    if (!match && hasDescription && !hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        matchDescription(imp.description, ex),
      );
      if (match) { match.confidence = "high"; }
    }

    // Rule 4: Low — date + amount + same account (no description match)
    if (!match && hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount,
      );
      if (match) { match.confidence = "low"; }
    }

    // Rule 5: Low — date ±1 day + amount + same account
    if (!match && hasAccount) {
      const neighbors = [...prevCandidates, ...nextCandidates];
      match = findMatch(neighbors, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount,
      );
      if (match) { match.confidence = "low"; }
    }

    if (match) {
      claimed.add(match.existingTransactionId);
      result.set(imp.id, match);
    }
  }

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
  predicate: (ex: Transaction) => boolean,
): DuplicateMatch | null {
  for (const ex of candidates) {
    if (claimed.has(ex.id)) continue;
    if (ex.amount !== amount) continue;
    if (!predicate(ex)) continue;
    return {
      confidence: "low", // caller overrides
      existingTransactionId: ex.id,
      matchedDate: ex.datetime.slice(0, 10),
      matchedAmount: ex.amount,
      matchedMerchant: ex.merchant,
      matchedCategoryId: ex.categoryId,
    };
  }
  return null;
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
