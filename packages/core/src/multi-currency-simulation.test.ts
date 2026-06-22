import { describe, expect, it } from "vitest";
import { createTransaction, updateTransaction } from "./entities/transactions";
import { bulkMoveAccount } from "./entities/bulk-transactions";
import { rebaseDefaultCurrency } from "./utils/rebase-currency";
import {
  resolveRate,
  stampFxRate,
  stampTransferRates,
  buildTodayRates,
} from "./utils/rates";
import { createConverter } from "./analytics/converter";
import { getNetWorthBreakdown } from "./analytics/queries";
import { getNetWorthOverTime } from "./analytics/analytics";
import { makeAccount } from "./test-factories";
import type { Account, BudgetMeta, Transaction, TransactionFormData } from "./entities/types";
import type { CurrencySettings } from "./utils/money";

// ─────────────────────────────────────────────────────────────────────────────
// A deterministic simulation of operations across three currencies — default
// RUB, foreign USD, foreign IDR — through the real pure functions the app and
// MCP write paths call. It is the regression net for the multi-currency math:
// every assertion is an exact integer, because the rates are pinned MANUAL
// overrides in the budget meta (not the drifting seed table), so the oracles
// below catch the whole bug class the owner hit without depending on live data.
//
// The oracles, asserted throughout the operation matrix:
//   1. Transfer conservation — a transfer touching the default nets to ~0 in
//      default value, after CREATE and after EDIT. The owner's corruption bug.
//   2. Native balance integrity — each account's native cents sum to what the
//      operations imply, asserted directly across the sequence.
//   3. No silent 1:1 — a foreign holding/flow converts at its real rate.
//   4. Move re-stamps — moving a flow to a different-currency account re-rates
//      its default value; to a default account clears it to face.
//   5. Rebase — switching the default rescales non-home flows by k and snaps
//      home flows to native face value.
//
// Money is integer cents ×100 for EVERY currency, including zero-decimal IDR:
// 10,000 RUB = 1,000,000 cents; 1,758,000 IDR = 175,800,000 cents.
// ─────────────────────────────────────────────────────────────────────────────

// Pinned rates → exact integer assertions. 1 USD = 90 RUB, 1 IDR = 1/175 RUB
// (175 IDR = 1 RUB). RUB is the default (implicit 1.0). The seed table is never
// consulted, so a future seed refresh can't move these numbers.
const USD_RUB = 90;
const IDR_RUB = 1 / 175;

function fmt(decimals: number, rate?: number): CurrencySettings {
  return {
    decimals,
    symbolPosition: decimals === 0 ? "after" : "before",
    ...(rate !== undefined ? { rate, rateSource: "manual" as const } : {}),
  };
}

function rubBudget(): BudgetMeta {
  return {
    schemaVersion: 4,
    name: "Multi",
    defaultCurrency: "RUB",
    currencies: {
      RUB: fmt(0),
      USD: fmt(2, USD_RUB),
      IDR: fmt(0, IDR_RUB),
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    lastModified: "2026-01-01T00:00:00.000Z",
  };
}

// The three accounts, one per currency.
function accounts(): Account[] {
  return [
    makeAccount({ id: "rub", name: "RUB Checking", currency: "RUB" }),
    makeAccount({ id: "usd", name: "USD Savings", currency: "USD" }),
    makeAccount({ id: "idr", name: "IDR Wallet", currency: "IDR" }),
  ];
}

// ── Resolution seam ──────────────────────────────────────────
// Mirror exactly what use-transaction-mutations.resolveRates does: the form
// hands core native amounts + account ids, the rates are resolved here from
// budget meta. Driving the sim through this keeps the test honest about the
// real write path rather than hand-stamping fxRate.

const acctCurrency = (id: string): string =>
  ({ rub: "RUB", usd: "USD", usd2: "USD", idr: "IDR" })[id] ?? "RUB";

function resolveRates(
  data: TransactionFormData,
  meta: BudgetMeta,
): Pick<TransactionFormData, "fxRate" | "toFxRate"> {
  if (data.type === "transfer") {
    const { fromRate, toRate } = stampTransferRates(
      acctCurrency(data.accountId),
      acctCurrency(data.toAccountId!),
      data.amount,
      data.toAmount ?? data.amount,
      meta.currencies,
      meta.defaultCurrency,
    );
    return { fxRate: fromRate, toFxRate: toRate };
  }
  return {
    fxRate: stampFxRate(acctCurrency(data.accountId), meta.currencies, meta.defaultCurrency),
  };
}

function create(data: TransactionFormData, meta: BudgetMeta, existing: Transaction[]): Transaction[] {
  return createTransaction({ ...data, ...resolveRates(data, meta) }, existing);
}

// ── Oracles ──────────────────────────────────────────────────

function converterFor(meta: BudgetMeta) {
  return createConverter(buildTodayRates(meta.currencies, meta.defaultCurrency), meta.defaultCurrency);
}

/** Native balance: the raw sum of an account's cents, no conversion. */
function nativeBalance(accountId: string, txns: Transaction[]): number {
  return txns.filter((t) => t.accountId === accountId).reduce((s, t) => s + t.amount, 0);
}

/** A transfer conserves value when its two legs, each valued in the default at
 *  their stamped rate, net to ~0 (±1 cent of genuine FX-spread rounding). */
function assertConserves(from: Transaction, to: Transaction, meta: BudgetMeta) {
  const conv = converterFor(meta);
  const net = conv.flowToDefault(from.amount, from.fxRate) + conv.flowToDefault(to.amount, to.fxRate);
  expect(Math.abs(net)).toBeLessThanOrEqual(1);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("multi-currency simulation — transfer conservation (the owner's bug)", () => {
  it("a default→foreign transfer nets to ~0 in default value on CREATE", () => {
    const meta = rubBudget();
    // 10,000 RUB → 1,758,000 IDR. From=default (no stamp), to=IDR.
    const txns = create(
      {
        type: "transfer",
        amount: 1_000_000, // 10,000 RUB in cents
        toAmount: 175_800_000, // 1,758,000 IDR in cents
        accountId: "rub",
        toAccountId: "idr",
        categoryId: "",
        date: "2026-02-01",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const from = txns.find((t) => t.amount < 0)!;
    const to = txns.find((t) => t.amount > 0)!;

    expect(from.amount).toBe(-1_000_000); // -10,000 RUB native
    expect(from.fxRate).toBeUndefined(); // default leg carries no stamp
    expect(to.amount).toBe(175_800_000); // +1,758,000 IDR native
    // The to-leg's rate is DERIVED from the two amounts — the real settlement
    // rate, not the table's 1/175. 1,000,000 / 175,800,000.
    expect(to.fxRate).toBeCloseTo(1_000_000 / 175_800_000, 15);
    assertConserves(from, to, meta);
  });

  it("THE corruption repro: editing the received IDR amount must NOT clobber the RUB leg", () => {
    // RUB default. Transfer 10,000 RUB → 1,758,000 IDR, then EDIT the received
    // amount to 1,800,000 IDR (settling at a different rate). This is the exact
    // sequence that produced the owner's -1,608,000 corruption: the from-leg's
    // native RUB amount was being overwritten with the inflow magnitude.
    const meta = rubBudget();
    let txns = create(
      {
        type: "transfer",
        amount: 1_000_000,
        toAmount: 175_800_000,
        accountId: "rub",
        toAccountId: "idr",
        categoryId: "",
        date: "2026-02-01",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const fromId = txns.find((t) => t.amount < 0)!.id;

    // Edit: the form resolves accountId=from(outflow), toAccountId=to(inflow)
    // regardless of which row was clicked. Only the received amount changes.
    const editData: TransactionFormData = {
      id: fromId,
      type: "transfer",
      amount: 1_000_000, // from-leg unchanged: still 10,000 RUB
      toAmount: 180_000_000, // received re-settled to 1,800,000 IDR
      accountId: "rub",
      toAccountId: "idr",
      categoryId: "",
      date: "2026-02-01",
      merchant: "",
      note: "",
    };
    txns = updateTransaction({ ...editData, ...resolveRates(editData, meta) }, txns);

    const from = txns.find((t) => t.amount < 0)!;
    const to = txns.find((t) => t.amount > 0)!;

    // The crux: the RUB from-leg stays -10,000 RUB. The bug clobbered it to
    // -1,800,000 (the inflow magnitude), corrupting the RUB balance by -1,608,000.
    expect(from.amount).toBe(-1_000_000);
    expect(from.amount).not.toBe(-180_000_000);
    expect(from.fxRate).toBeUndefined();

    // The IDR leg is the new received amount, its rate re-derived from the two
    // amounts so the legs still net to ~0.
    expect(to.amount).toBe(180_000_000);
    expect(to.fxRate).toBeCloseTo(1_000_000 / 180_000_000, 15);
    assertConserves(from, to, meta);

    // Native balances: RUB account holds exactly -10,000 RUB, IDR +1,800,000.
    expect(nativeBalance("rub", txns)).toBe(-1_000_000);
    expect(nativeBalance("idr", txns)).toBe(180_000_000);
  });

  it("a foreign→default transfer nets to ~0 and derives the from-leg rate", () => {
    // 90 USD → 8,100 RUB (the table rate, exact). From=USD, to=default.
    const meta = rubBudget();
    const txns = create(
      {
        type: "transfer",
        amount: 9_000, // 90.00 USD in cents
        toAmount: 810_000, // 8,100 RUB in cents
        accountId: "usd",
        toAccountId: "rub",
        categoryId: "",
        date: "2026-02-02",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const from = txns.find((t) => t.amount < 0)!; // USD outflow
    const to = txns.find((t) => t.amount > 0)!; // RUB inflow

    expect(from.amount).toBe(-9_000);
    // to=default → fromRate = toAmount / fromAmount = 810,000 / 9,000 = 90.
    expect(from.fxRate).toBeCloseTo(90, 12);
    expect(to.amount).toBe(810_000);
    expect(to.fxRate).toBeUndefined(); // default leg, no stamp
    assertConserves(from, to, meta);
  });

  it("a foreign→foreign transfer stamps each leg's own resolver rate", () => {
    // 90 USD → 1,575,000 IDR. Neither leg is the default; the amounts pin the
    // USD↔IDR rate but not either →RUB rate, so each leg stamps its resolver rate.
    const meta = rubBudget();
    const txns = create(
      {
        type: "transfer",
        amount: 9_000, // 90.00 USD
        toAmount: 157_500_000, // 1,575,000 IDR
        accountId: "usd",
        toAccountId: "idr",
        categoryId: "",
        date: "2026-02-03",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const from = txns.find((t) => t.amount < 0)!;
    const to = txns.find((t) => t.amount > 0)!;

    expect(from.fxRate).toBeCloseTo(USD_RUB, 12); // USD→RUB resolver rate
    expect(to.fxRate).toBeCloseTo(IDR_RUB, 12); // IDR→RUB resolver rate
    // 90 USD ≈ 8,100 RUB; 1,575,000 IDR ≈ 9,000 RUB. The 900-RUB gap is genuine
    // FX spread (the off-table cross rate), so conservation holds only loosely —
    // assert the spread is the real residue, not a corruption.
    const conv = converterFor(meta);
    const net = conv.flowToDefault(from.amount, from.fxRate) + conv.flowToDefault(to.amount, to.fxRate);
    expect(net).toBe(-810_000 + 900_000); // exact: spread is +90,000 cents = 900 RUB
  });

  it("editing a both-foreign transfer's received amount re-stamps resolver rates, NOT a netting bank rate", () => {
    // Intended both-foreign behavior: when neither leg is the default, editing the
    // received toAmount re-derives via stampTransferRates, which stamps each leg's
    // OWN resolver rate (USD→RUB, IDR→RUB) — it does NOT derive a bank rate from the
    // two amounts. So the legs do NOT net to ~0; the residual is a genuine FX spread
    // (the amounts pin only the USD↔IDR cross rate, not either →default rate). This
    // is correct per design — not the default-touching conservation case.
    const meta = rubBudget();
    let txns = create(
      {
        type: "transfer",
        amount: 9_000, // 90.00 USD
        toAmount: 157_500_000, // 1,575,000 IDR
        accountId: "usd",
        toAccountId: "idr",
        categoryId: "",
        date: "2026-02-03",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const fromId = txns.find((t) => t.amount < 0)!.id;

    // Edit only the received IDR amount to a new settlement (1,600,000 IDR).
    const editData: TransactionFormData = {
      id: fromId,
      type: "transfer",
      amount: 9_000, // outflow unchanged: still 90.00 USD
      toAmount: 160_000_000, // received re-settled to 1,600,000 IDR
      accountId: "usd",
      toAccountId: "idr",
      categoryId: "",
      date: "2026-02-03",
      merchant: "",
      note: "",
    };
    txns = updateTransaction({ ...editData, ...resolveRates(editData, meta) }, txns);

    const from = txns.find((t) => t.amount < 0)!;
    const to = txns.find((t) => t.amount > 0)!;

    // Leg amounts update to the edited values.
    expect(from.amount).toBe(-9_000); // USD outflow unchanged
    expect(to.amount).toBe(160_000_000); // IDR inflow is the new received amount

    // Each leg carries its OWN resolver rate — NOT a derived rate that would make
    // the legs net to zero.
    expect(from.fxRate).toBeCloseTo(USD_RUB, 12); // USD→RUB resolver rate
    expect(to.fxRate).toBeCloseTo(IDR_RUB, 12); // IDR→RUB resolver rate
    expect(to.fxRate).not.toBeCloseTo(from.amount / to.amount, 12); // not a netting bank rate

    // The legs deliberately do NOT net to ~0: 90 USD ≈ 8,100 RUB out, 1,600,000 IDR
    // ≈ 9,142.86 RUB in. The residue is the genuine FX spread, asserted exactly.
    const conv = converterFor(meta);
    const net = conv.flowToDefault(from.amount, from.fxRate) + conv.flowToDefault(to.amount, to.fxRate);
    expect(net).toBe(-810_000 + Math.round(160_000_000 * IDR_RUB));
    expect(Math.abs(net)).toBeGreaterThan(1); // a real spread, not conservation
  });

  it("a same-currency foreign transfer mirrors one amount and shares one rate", () => {
    // 5 USD between two USD accounts (modeled here as usd→usd via a second id):
    // a same-currency transfer leaves toAmount unset, so the to leg mirrors the
    // from and both share the one stamped USD→RUB rate.
    const meta = rubBudget();
    const txns = create(
      {
        type: "transfer",
        amount: 500, // 5.00 USD
        accountId: "usd",
        toAccountId: "usd2",
        categoryId: "",
        date: "2026-02-04",
        merchant: "",
        note: "",
      },
      meta,
      [],
    );
    const from = txns.find((t) => t.amount < 0)!;
    const to = txns.find((t) => t.amount > 0)!;
    expect(from.amount).toBe(-500);
    expect(to.amount).toBe(500); // mirrored
    expect(from.fxRate).toBeCloseTo(USD_RUB, 12);
    expect(to.fxRate).toBe(from.fxRate); // shared
    assertConserves(from, to, meta);
  });
});

describe("multi-currency simulation — native balance integrity & no silent 1:1", () => {
  it("tracks every account's native balance exactly across a flow sequence", () => {
    const meta = rubBudget();
    let txns: Transaction[] = [];

    // RUB account: +50,000 income, -12,000 expense.
    txns = create(
      { type: "income", amount: 5_000_000, accountId: "rub", categoryId: "c", date: "2026-03-01", merchant: "Salary", note: "" },
      meta,
      txns,
    );
    txns = create(
      { type: "expense", amount: 1_200_000, accountId: "rub", categoryId: "c", date: "2026-03-02", merchant: "Rent", note: "" },
      meta,
      txns,
    );
    // USD account: +1,000 income, -250 expense.
    txns = create(
      { type: "income", amount: 100_000, accountId: "usd", categoryId: "c", date: "2026-03-03", merchant: "Freelance", note: "" },
      meta,
      txns,
    );
    txns = create(
      { type: "expense", amount: 25_000, accountId: "usd", categoryId: "c", date: "2026-03-04", merchant: "Hosting", note: "" },
      meta,
      txns,
    );
    // IDR account: +13,900,000 income, -2,400,000 expense.
    txns = create(
      { type: "income", amount: 1_390_000_000, accountId: "idr", categoryId: "c", date: "2026-03-05", merchant: "Gig", note: "" },
      meta,
      txns,
    );
    txns = create(
      { type: "expense", amount: 240_000_000, accountId: "idr", categoryId: "c", date: "2026-03-06", merchant: "Scooter", note: "" },
      meta,
      txns,
    );

    // Native balances are the raw cent sums — no conversion.
    expect(nativeBalance("rub", txns)).toBe(5_000_000 - 1_200_000); // 38,000 RUB
    expect(nativeBalance("usd", txns)).toBe(100_000 - 25_000); // 750 USD
    expect(nativeBalance("idr", txns)).toBe(1_390_000_000 - 240_000_000); // 11,500,000 IDR

    // No silent 1:1: each foreign holding converts at its real rate. The USD
    // balance (750.00) is worth 750 × 90 = 67,500 RUB; IDR (11,500,000) is worth
    // 11,500,000 / 175 ≈ 65,714.28 RUB.
    const conv = converterFor(meta);
    expect(conv.holdingToDefault(750_00, "USD")).toBe(Math.round(75_000 * USD_RUB));
    expect(conv.holdingToDefault(750_00, "USD")).not.toBe(75_000); // not 1:1
    expect(conv.holdingToDefault(1_150_000_000, "IDR")).toBe(Math.round(1_150_000_000 * IDR_RUB));
    expect(conv.holdingToDefault(1_150_000_000, "IDR")).not.toBe(1_150_000_000); // not 1:1

    // The default (RUB) account is the identity — face value, no conversion.
    expect(conv.holdingToDefault(3_800_000, "RUB")).toBe(3_800_000);

    // Net worth breakdown reconciles exactly: spot === costBasis + fxDelta. With
    // every flow stamped at today's rate, costBasis and spot coincide up to
    // per-transaction vs per-account rounding (cost basis rounds each flow, spot
    // rounds the summed native), so fxDelta is sub-cent rounding noise, not real
    // unrealized FX.
    const breakdown = getNetWorthBreakdown(accounts(), txns, conv);
    expect(breakdown.spot).toBe(breakdown.costBasis + breakdown.fxDelta);
    expect(Math.abs(breakdown.fxDelta)).toBeLessThanOrEqual(1);
  });

  it("a rate of exactly 1 IS allowed to convert 1:1 — the no-1:1 rule is about silence", () => {
    // A foreign currency pinned at rate 1 (e.g. a peg) genuinely converts 1:1;
    // the rule forbids a silent fall-through to 1.0, not a real unit rate.
    const meta = rubBudget();
    meta.currencies.USD = fmt(2, 1); // hypothetical 1 USD = 1 RUB peg
    const conv = converterFor(meta);
    expect(conv.holdingToDefault(100_00, "USD")).toBe(100_00);
  });
});

describe("multi-currency simulation — moving a flow re-stamps its rate", () => {
  it("moving a plain flow to a different-currency account re-rates its default value", () => {
    const meta = rubBudget();
    // A 100 USD expense, stamped USD→RUB = 90 → default value 9,000 RUB.
    let txns = create(
      { type: "expense", amount: 10_000, accountId: "usd", categoryId: "c", date: "2026-04-01", merchant: "X", note: "" },
      meta,
      [],
    );
    const id = txns[0].id;
    const conv = converterFor(meta);
    expect(conv.flowToDefault(txns[0].amount, txns[0].fxRate)).toBe(-Math.round(10_000 * USD_RUB)); // -900,000

    // Move to the IDR account: re-stamp to IDR→RUB. The hook resolves the target
    // rate; here it's the IDR resolver rate. Native amount is unchanged (the move
    // doesn't convert the number, only re-labels its currency).
    const idrRate = stampFxRate("IDR", meta.currencies, meta.defaultCurrency);
    txns = updateTransaction(
      {
        id,
        type: "expense",
        amount: 10_000, // native magnitude unchanged; only the account moves
        accountId: "idr",
        categoryId: "c",
        date: "2026-04-01",
        merchant: "X",
        note: "",
        fxRate: idrRate,
      },
      txns,
    );
    const moved = txns.find((t) => t.id === id)!;
    expect(moved.accountId).toBe("idr");
    expect(moved.fxRate).toBeCloseTo(IDR_RUB, 15);
    // Default value re-derives: 10,000 IDR cents × IDR→RUB ≈ 57 RUB, not 900,000.
    expect(conv.flowToDefault(moved.amount, moved.fxRate)).toBe(-Math.round(10_000 * IDR_RUB));
    expect(conv.flowToDefault(moved.amount, moved.fxRate)).not.toBe(-Math.round(10_000 * USD_RUB));
  });

  it("moving a flow to a default-currency account clears fxRate to face value", () => {
    const meta = rubBudget();
    let txns = create(
      { type: "expense", amount: 10_000, accountId: "usd", categoryId: "c", date: "2026-04-02", merchant: "Y", note: "" },
      meta,
      [],
    );
    const id = txns[0].id;
    expect(txns[0].fxRate).toBeCloseTo(USD_RUB, 12);

    // Move to the RUB (default) account → stampFxRate returns undefined → cleared.
    const rubRate = stampFxRate("RUB", meta.currencies, meta.defaultCurrency);
    expect(rubRate).toBeUndefined();
    txns = updateTransaction(
      { id, type: "expense", amount: 10_000, accountId: "rub", categoryId: "c", date: "2026-04-02", merchant: "Y", note: "", fxRate: rubRate },
      txns,
    );
    const moved = txns.find((t) => t.id === id)!;
    expect(moved.accountId).toBe("rub");
    expect(moved.fxRate).toBeUndefined();
    const conv = converterFor(meta);
    expect(conv.flowToDefault(moved.amount, moved.fxRate)).toBe(-10_000); // face value
  });

  it("bulkMoveAccount re-stamps every moved flow to the target's rate", () => {
    const meta = rubBudget();
    // Two RUB-account expenses (default, no stamp).
    let txns = create(
      { type: "expense", amount: 30_000, accountId: "rub", categoryId: "c", date: "2026-04-03", merchant: "A", note: "" },
      meta,
      [],
    );
    txns = create(
      { type: "expense", amount: 70_000, accountId: "rub", categoryId: "c", date: "2026-04-04", merchant: "B", note: "" },
      meta,
      txns,
    );
    expect(txns.every((t) => t.fxRate === undefined)).toBe(true);

    // Bulk-move both to the USD account. The hook resolves the target's rate once
    // (USD→RUB) and core writes it to every moved row.
    const usdRate = stampFxRate("USD", meta.currencies, meta.defaultCurrency);
    const ids = new Set(txns.map((t) => t.id));
    txns = bulkMoveAccount(ids, "usd", usdRate, txns);

    expect(txns.every((t) => t.accountId === "usd")).toBe(true);
    expect(txns.every((t) => t.fxRate === USD_RUB)).toBe(true);
    const conv = converterFor(meta);
    // -30,000 and -70,000 native cents now value at ×90 in default.
    expect(conv.flowToDefault(txns[0].amount, txns[0].fxRate)).toBe(-Math.round(30_000 * USD_RUB));
    expect(conv.flowToDefault(txns[1].amount, txns[1].fxRate)).toBe(-Math.round(70_000 * USD_RUB));
  });
});

describe("multi-currency simulation — rebase the default currency RUB → USD", () => {
  // A realistic mixed ledger, then switch the unit of account from RUB to USD.
  function ledger(): { meta: BudgetMeta; accts: Account[]; txns: Transaction[] } {
    const meta = rubBudget();
    const accts = accounts();
    let txns: Transaction[] = [];
    // RUB (will become foreign): a default flow, no stamp.
    txns = create(
      { type: "income", amount: 9_000_000, accountId: "rub", categoryId: "c", date: "2026-05-01", merchant: "Salary", note: "" },
      meta,
      txns,
    );
    // USD (will become home): stamped USD→RUB = 90.
    txns = create(
      { type: "income", amount: 100_000, accountId: "usd", categoryId: "c", date: "2026-05-02", merchant: "Consulting", note: "" },
      meta,
      txns,
    );
    // IDR (stays foreign): stamped IDR→RUB.
    txns = create(
      { type: "income", amount: 1_750_000_000, accountId: "idr", categoryId: "c", date: "2026-05-03", merchant: "Gig", note: "" },
      meta,
      txns,
    );
    return { meta, accts, txns };
  }

  it("scales non-home (RUB, IDR) flows by k and snaps home (USD) flows to face", () => {
    const { meta, accts, txns } = ledger();
    // k = rate(OLD→NEW) = rate(RUB→USD) = 1 / rate(USD→RUB) = 1/90.
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;
    expect(k).toBeCloseTo(1 / 90, 15);

    const result = rebaseDefaultCurrency(meta, accts, txns, "USD");
    expect(result.meta.defaultCurrency).toBe("USD");

    const conv = converterFor(result.meta);
    const byId = (id: string) => result.transactions.find((t) => t.accountId === id)!;

    // Home USD flow: fxRate cleared, default value === native face ($1000.00).
    const usd = byId("usd");
    expect(usd.fxRate).toBeUndefined();
    expect(usd.amount).toBe(100_000);
    expect(conv.flowToDefault(usd.amount, usd.fxRate)).toBe(100_000); // $1000, not scaled

    // Non-home RUB and IDR flows: native amount untouched, default value ≈ old × k.
    for (const id of ["rub", "idr"] as const) {
      const before = txns.find((t) => t.accountId === id)!;
      const after = byId(id);
      expect(after.amount).toBe(before.amount); // native never moves
      const valueOld = Math.round(before.amount * (before.fxRate ?? 1)); // in RUB
      const valueNew = Math.round(after.amount * (after.fxRate ?? 1)); // in USD
      expect(Math.abs(valueNew - valueOld * k)).toBeLessThanOrEqual(1);
    }

    // defaultCurrency is USD; NEW is the rate-free default entry.
    expect(result.meta.defaultCurrency).toBe("USD");
    expect(result.meta.currencies.USD.rate).toBeUndefined();
  });

  it("keeps the foreign-slice net-worth-over-time shape, scaled by k", () => {
    const { meta, accts, txns } = ledger();
    const k = 1 / resolveRate("USD", meta.currencies, "RUB").rate;
    const result = rebaseDefaultCurrency(meta, accts, txns, "USD");

    const range = {
      start: new Date("2026-05-01T00:00:00.000Z"),
      end: new Date("2026-06-01T00:00:00.000Z"),
    };
    const before = getNetWorthOverTime(accts, txns, range, undefined, converterFor(meta));
    const after = getNetWorthOverTime(result.accounts, result.transactions, range, undefined, converterFor(result.meta));

    expect(after.length).toBe(before.length);
    expect(before.length).toBeGreaterThan(0);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].date).toBe(before[i].date);
      const scaled = before[i].netWorth * k;
      // Independent rounding (RUB cents vs USD cents) leaves sub-unit noise;
      // bound it relative to the point's own magnitude.
      const tolerance = Math.max(2, Math.abs(scaled) * 1e-4);
      expect(Math.abs(after[i].netWorth - scaled)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("relabels a single-currency (all-RUB) budget to USD with no stamps and unchanged numbers", () => {
    const meta = rubBudget();
    // Override the map to a pure single-currency RUB budget.
    meta.currencies = { RUB: fmt(0) };
    const rubOnly: Account[] = [
      makeAccount({ id: "a", currency: "RUB" }),
      makeAccount({ id: "b", currency: "RUB" }),
    ];
    let txns: Transaction[] = [];
    txns = create(
      { type: "income", amount: 500_000, accountId: "a", categoryId: "c", date: "2026-05-10", merchant: "P", note: "" },
      meta,
      txns,
    );
    txns = create(
      { type: "expense", amount: 120_000, accountId: "b", categoryId: "c", date: "2026-05-11", merchant: "Q", note: "" },
      meta,
      txns,
    );

    const result = rebaseDefaultCurrency(meta, rubOnly, txns, "USD");
    expect(result.meta.defaultCurrency).toBe("USD");
    expect(Object.keys(result.meta.currencies)).toEqual(["USD"]);
    expect(result.accounts.every((a) => a.currency === "USD")).toBe(true);
    // Amounts numerically unchanged; no fxRate introduced.
    expect(result.transactions.map((t) => t.amount)).toEqual([500_000, -120_000]);
    expect(result.transactions.every((t) => t.fxRate === undefined)).toBe(true);
    // Transactions pass through by reference (no stamp touched).
    expect(result.transactions).toBe(txns);
  });
});
