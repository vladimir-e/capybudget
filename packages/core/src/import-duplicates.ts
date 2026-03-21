import type { Transaction } from "./types";
import type { ImportTransaction } from "./import-types";

export type DuplicateConfidence = "high" | "low";

export interface DuplicateMatch {
  confidence: DuplicateConfidence;
  existingTransactionId: string;
  matchedDate: string;
  matchedAmount: number;
}

/**
 * Detect import transactions that likely already exist in the budget.
 *
 * Matching rules (checked in order, first match wins):
 * 1. High — date + amount + description (non-empty) + same resolved account
 * 2. High — date + amount + description (non-empty), no account info on import side
 * 3. Low  — date + amount + same resolved account (description empty or different)
 * 4. Low  — date ±1 day + amount + same resolved account
 *
 * Account resolution uses accountMapping (sourceAccount → accountId).
 */
export function detectDuplicates(
  importTxns: ImportTransaction[],
  existingTxns: Transaction[],
  accountMapping: Record<string, string>,
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

    // Collect candidate dates: exact date + ±1 day neighbors
    const exactCandidates = byDate.get(imp.date) ?? [];
    const prevDay = offsetDate(imp.date, -1);
    const nextDay = offsetDate(imp.date, 1);
    const prevCandidates = byDate.get(prevDay) ?? [];
    const nextCandidates = byDate.get(nextDay) ?? [];

    let match: DuplicateMatch | null = null;

    // Rule 1: High — date + amount + description + same account
    if (hasDescription && hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount && matchDescription(imp.description, ex),
      );
      if (match) { match.confidence = "high"; }
    }

    // Rule 2: High — date + amount + description, no account on import side
    if (!match && hasDescription && !hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        matchDescription(imp.description, ex),
      );
      if (match) { match.confidence = "high"; }
    }

    // Rule 3: Low — date + amount + same account (no description match)
    if (!match && hasAccount) {
      match = findMatch(exactCandidates, claimed, imp.amount, (ex) =>
        ex.accountId === resolvedAccount,
      );
      if (match) { match.confidence = "low"; }
    }

    // Rule 4: Low — date ±1 day + amount + same account
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
