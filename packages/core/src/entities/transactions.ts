import type { Transaction, TransactionType } from "./types";

export interface TransactionFormData {
  id?: string;
  type: TransactionType;
  amount: number; // positive cents
  categoryId: string;
  accountId: string;
  toAccountId?: string;
  date: string;
  merchant: string;
  note: string;
  /** The native→default rate to freeze on creation, resolved by the caller
   *  from the account's currency (see `stampFxRate`). For a transfer this is the
   *  from-leg's rate. Undefined leaves the field empty — a default-currency
   *  transaction at an implicit 1.0. Applied verbatim on create *and* update:
   *  the caller resolves the rate for the (possibly changed) account; core just
   *  writes it, so moving a transaction to a different-currency account re-rates
   *  it correctly. */
  fxRate?: number;
  /** Cross-currency transfer only: the inflow magnitude in the to-account's
   *  currency, when it differs from the from-account's. Absent means a
   *  same-currency transfer — the to leg mirrors `amount`. */
  toAmount?: number;
  /** Cross-currency transfer only: the to-leg's native→default rate (see
   *  `stampTransferRates`). Absent means the to leg shares `fxRate`. */
  toFxRate?: number;
}

/** Create one (or two, for transfers) new transactions. Returns the new full list. */
function localTimeString(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function createTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  const now = new Date();
  const createdAt = now.toISOString();
  const datetime = `${input.date}T${localTimeString(now)}`;

  if (input.type === "transfer") {
    const fromId = crypto.randomUUID();
    const toId = crypto.randomUUID();
    // A same-currency transfer leaves toAmount/toFxRate unset, so the to leg
    // mirrors the from leg and both share the one stamped rate. A cross-currency
    // transfer carries an independent to-side amount and its own per-leg rate —
    // and `input.toAmount` being present is exactly what marks it cross-currency,
    // so the to-leg's rate is taken verbatim then, including a deliberate
    // `undefined` for a default-currency to-leg (which must carry no stamp; the
    // `?? fxRate` fallback would otherwise clobber it with the from leg's rate).
    const isCrossCurrency = input.toAmount !== undefined;
    const toAmount = input.toAmount ?? input.amount;
    const toFxRate = isCrossCurrency ? input.toFxRate : input.fxRate;
    const base = {
      datetime,
      type: "transfer" as const,
      categoryId: "",
      merchant: "",
      note: input.note,
      createdAt,
    };
    return [
      ...existing,
      { ...base, id: fromId, amount: -input.amount, accountId: input.accountId, transferPairId: toId, fxRate: input.fxRate },
      { ...base, id: toId, amount: toAmount, accountId: input.toAccountId!, transferPairId: fromId, fxRate: toFxRate },
    ];
  }

  return [
    ...existing,
    {
      id: crypto.randomUUID(),
      datetime,
      type: input.type,
      amount: input.type === "expense" ? -input.amount : input.amount,
      categoryId: input.categoryId,
      accountId: input.accountId,
      transferPairId: "",
      merchant: input.merchant,
      note: input.note,
      createdAt,
      fxRate: input.fxRate,
    },
  ];
}

/** If the date portion changed, generate a new datetime with current time; otherwise keep the original. */
function resolveDateTime(inputDate: string, originalDatetime: string): string {
  const originalDate = originalDatetime.split("T")[0];
  if (inputDate === originalDate) return originalDatetime;
  return `${inputDate}T${localTimeString(new Date())}`;
}

/** Update an existing transaction (and its transfer pair if applicable). Returns the new full list. */
export function updateTransaction(
  input: TransactionFormData,
  existing: Transaction[],
): Transaction[] {
  if (input.type === "transfer") {
    // The form resolves transfer pairs so input.accountId = from (outflow),
    // input.toAccountId = to (inflow), regardless of which leg was clicked.
    // Both legs are fully rewritten based on the resolved from/to. Same-currency
    // transfers leave toAmount/toFxRate unset, so the to leg mirrors the from
    // leg's amount and shares its rate; cross-currency edits carry both — and an
    // `input.toAmount` marks the edit cross-currency, so the to-leg rate is taken
    // verbatim then (a default-currency to-leg's deliberate `undefined` survives
    // instead of being clobbered by the from leg's rate).
    const original = existing.find((t) => t.id === input.id);
    const pairId = original?.transferPairId;
    const datetime = resolveDateTime(input.date, original?.datetime ?? "");
    const toAmount = input.toAmount ?? input.amount;
    const toFxRate = input.toAmount !== undefined ? input.toFxRate : input.fxRate;

    return existing.map((t) => {
      if (t.id === input.id) {
        return { ...t, amount: -input.amount, accountId: input.accountId, fxRate: input.fxRate, datetime, merchant: "", note: input.note };
      }
      if (pairId && t.id === pairId) {
        return { ...t, amount: toAmount, accountId: input.toAccountId!, fxRate: toFxRate, datetime, merchant: "", note: input.note };
      }
      return t;
    });
  }

  const original = existing.find((t) => t.id === input.id);
  const datetime = resolveDateTime(input.date, original?.datetime ?? "");

  return existing.map((t) =>
    t.id === input.id
      ? { ...t, type: input.type, amount: input.type === "expense" ? -input.amount : input.amount, categoryId: input.categoryId, accountId: input.accountId, fxRate: input.fxRate, datetime, merchant: input.merchant, note: input.note }
      : t,
  );
}

/** Delete a transaction (and its transfer pair if applicable). Returns the new full list. */
export function deleteTransaction(
  txn: Transaction,
  existing: Transaction[],
): Transaction[] {
  if (txn.type === "transfer" && txn.transferPairId) {
    return existing.filter((t) => t.id !== txn.id && t.id !== txn.transferPairId);
  }
  return existing.filter((t) => t.id !== txn.id);
}
