import { createAccount } from "./accounts";
import type { Account, Transaction } from "./types";
import type { ImportTransaction, ImportAliases } from "./import-types";

export interface MergeInput {
  transactions: ImportTransaction[];
  selectedIds: Set<string>;
  accountMapping: Record<string, string>; // sourceAccount → accountId | "__create__"
}

export interface MergeOutput {
  accounts: Account[];
  transactions: Transaction[];
  aliases: ImportAliases;
  createdAccountIds: Record<string, string>; // sourceAccount → new accountId
  sourcesToCreate: string[];
}

/**
 * Detect and mutually link transfer pairs among newly created transactions.
 *
 * A pair is two transfers with the same date, opposite amounts, and different
 * resolved accounts. Pairing is greedy: first match wins. Unmatched transfers
 * keep `transferPairId: ""`.
 *
 * Skips transfers that are already paired (e.g. single-leg transfers with
 * targetAccountId that were pre-paired during creation).
 *
 * @param txns  Output transactions (mutated in place)
 */
function linkTransferPairs(txns: Transaction[]): void {
  const paired = new Set<number>();

  for (let i = 0; i < txns.length; i++) {
    if (paired.has(i)) continue;
    if (txns[i].type !== "transfer") continue;
    if (!txns[i].accountId) continue;
    if (txns[i].transferPairId) continue; // already paired

    for (let j = i + 1; j < txns.length; j++) {
      if (paired.has(j)) continue;
      if (txns[j].type !== "transfer") continue;
      if (!txns[j].accountId) continue;
      if (txns[j].transferPairId) continue; // already paired

      const sameDate = txns[i].datetime.split("T")[0] === txns[j].datetime.split("T")[0];
      const oppositeAmounts =
        txns[i].amount !== 0 &&
        txns[i].amount === -txns[j].amount;
      const differentAccounts = txns[i].accountId !== txns[j].accountId;

      if (sameDate && oppositeAmounts && differentAccounts) {
        txns[i].transferPairId = txns[j].id;
        txns[j].transferPairId = txns[i].id;
        paired.add(i);
        paired.add(j);
        break;
      }
    }
  }
}

/**
 * Pure transformation: takes import data + existing budget state and produces
 * the next budget state. No I/O — the caller is responsible for persistence.
 *
 * Accounts with mapping "__create__" or no mapping are auto-created as
 * "checking" — the most common type for imported bank data.
 */
export function prepareMerge(
  input: MergeInput,
  prevAccounts: Account[],
  prevTransactions: Transaction[],
  existingAliases: ImportAliases = { accounts: {} },
): MergeOutput {
  const { transactions, selectedIds, accountMapping } = input;
  const selected = transactions.filter((t) => selectedIds.has(t.id));
  if (selected.length === 0) throw new Error("No transactions selected");

  // ── Create accounts for unmapped sources ──────────────────
  const sourcesToCreate = [
    ...new Set(selected.map((t) => t.sourceAccount).filter(Boolean)),
  ].filter(
    (s) => !accountMapping[s] || accountMapping[s] === "__create__",
  );

  const nextAccounts = [...prevAccounts];
  const createdAccountIds: Record<string, string> = {};

  for (const source of sourcesToCreate) {
    const acct = createAccount(
      { name: source, type: "checking" },
      nextAccounts,
    );
    nextAccounts.push(acct);
    createdAccountIds[source] = acct.id;
  }

  // ── Resolve account ID per transaction ────────────────────
  const resolveAccount = (t: ImportTransaction): string => {
    if (createdAccountIds[t.sourceAccount]) return createdAccountIds[t.sourceAccount];
    const mapped = accountMapping[t.sourceAccount];
    if (mapped && mapped !== "__create__") return mapped;
    return t.accountId || "";
  };

  // ── Resolve target account for transfers ───────────────────
  const resolveTargetAccount = (t: ImportTransaction): string => {
    if (!t.targetAccountId) return "";
    // targetAccountId is already a budget account UUID set during enrichment/UI
    return t.targetAccountId;
  };

  // ── Convert to budget transactions ────────────────────────
  const createdAt = new Date().toISOString();
  const newTxns: Transaction[] = [];

  for (const t of selected) {
    const accountId = resolveAccount(t);

    if (t.type === "transfer" && resolveTargetAccount(t)) {
      // Single-leg transfer with known target → create proper paired transactions
      const targetId = resolveTargetAccount(t);
      const fromId = crypto.randomUUID();
      const toId = crypto.randomUUID();
      const note = [t.description, t.memo].filter(Boolean).join(" — ");

      if (t.amount < 0) {
        // Outflow: money leaves accountId, arrives at targetId
        newTxns.push(
          { id: fromId, datetime: `${t.date}T00:00:00.000`, type: "transfer", amount: t.amount, categoryId: "", accountId, transferPairId: toId, merchant: "", note, createdAt },
          { id: toId, datetime: `${t.date}T00:00:00.000`, type: "transfer", amount: -t.amount, categoryId: "", accountId: targetId, transferPairId: fromId, merchant: "", note, createdAt },
        );
      } else {
        // Inflow: money arrives at accountId, leaves targetId
        newTxns.push(
          { id: toId, datetime: `${t.date}T00:00:00.000`, type: "transfer", amount: t.amount, categoryId: "", accountId, transferPairId: fromId, merchant: "", note, createdAt },
          { id: fromId, datetime: `${t.date}T00:00:00.000`, type: "transfer", amount: -t.amount, categoryId: "", accountId: targetId, transferPairId: toId, merchant: "", note, createdAt },
        );
      }
    } else {
      // Regular expense/income or unmatched transfer (kept as-is for now)
      newTxns.push({
        id: crypto.randomUUID(),
        datetime: `${t.date}T00:00:00.000`,
        type: t.type,
        amount: t.amount,
        categoryId: t.type === "transfer" ? "" : (t.categoryId || ""),
        accountId,
        transferPairId: "",
        merchant: t.type === "transfer" ? "" : (t.merchant || ""),
        note: [t.description, t.memo].filter(Boolean).join(" — "),
        createdAt,
      });
    }
  }

  // ── Link transfer pairs (YNAB-style two-leg imports) ───────────
  linkTransferPairs(newTxns);

  // ── Downgrade unpaired transfers to income/expense ─────────────
  for (let i = 0; i < newTxns.length; i++) {
    const t = newTxns[i];
    if (t.type === "transfer" && !t.transferPairId) {
      newTxns[i] = { ...t, type: t.amount < 0 ? "expense" : "income" };
    }
  }

  const nextTransactions = [...prevTransactions, ...newTxns];

  // ── Build updated aliases ─────────────────────────────────
  const aliases: ImportAliases = {
    accounts: { ...existingAliases.accounts },
  };

  for (const [source, target] of Object.entries(accountMapping)) {
    if (target === "__create__" && createdAccountIds[source]) {
      aliases.accounts[source] = createdAccountIds[source];
    } else if (target && target !== "__create__") {
      aliases.accounts[source] = target;
    }
  }

  return {
    accounts: nextAccounts,
    transactions: nextTransactions,
    aliases,
    createdAccountIds,
    sourcesToCreate,
  };
}
