import { describe, it, expect } from "vitest";
import {
  makeAccount,
  makeCategory,
  makeTransaction,
  makeImportTransaction,
} from "../test-factories";
import { groundImport, type GroundImportInput } from "./import-grounding";
import type { Account, Category, Transaction } from "../entities/types";
import type { ImportTransaction } from "./import-types";

// ── Shared fixtures ──────────────────────────────────────────────

const GROCERIES = makeCategory({ id: "cat-groceries", name: "Groceries", group: "Daily Living" });
const RENT = makeCategory({ id: "cat-rent", name: "Housing", group: "Fixed" });
const DINING = makeCategory({ id: "cat-dining", name: "Dining Out", group: "Daily Living" });
const OTHER_INCOME = makeCategory({ id: "cat-income", name: "Other Income", group: "Income" });

const CHECKING = makeAccount({ id: "acct-checking", name: "Chase Checking" });
const SAVINGS = makeAccount({ id: "acct-savings", name: "Ally Savings" });
const BROKERAGE = makeAccount({ id: "acct-brokerage", name: "Fidelity Brokerage" });

function input(over: Partial<GroundImportInput> = {}): GroundImportInput {
  return {
    rows: [],
    history: [],
    accounts: [CHECKING],
    categories: [GROCERIES, RENT, DINING, OTHER_INCOME],
    ...over,
  };
}

/** A historical transfer: two paired legs moving `amount` (cents) from
 *  `fromAccountId` to `toAccountId`. The outflow leg sits on the source
 *  (negative), the inflow on the destination (positive). */
function transferLegs(
  fromAccountId: string,
  toAccountId: string,
  datetime: string,
  idPrefix: string,
  amount = 50000,
): Transaction[] {
  const fromId = `${idPrefix}-from`;
  const toId = `${idPrefix}-to`;
  return [
    makeTransaction({
      id: fromId, type: "transfer", merchant: "", note: "", categoryId: "",
      accountId: fromAccountId, transferPairId: toId, amount: -amount, datetime,
    }),
    makeTransaction({
      id: toId, type: "transfer", merchant: "", note: "", categoryId: "",
      accountId: toAccountId, transferPairId: fromId, amount, datetime,
    }),
  ];
}

/** N historical txns for one merchant, all in one category, recent-ish dates. */
function historyFor(
  merchant: string,
  categoryId: string,
  count: number,
): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      id: `${merchant}-${categoryId}-${i}`,
      merchant,
      note: merchant.toUpperCase(),
      categoryId,
      accountId: "acct-checking",
      datetime: `2025-${String(1 + (i % 9)).padStart(2, "0")}-15T00:00:00.000`,
    }),
  );
}

// ── Fast-path resolver ───────────────────────────────────────────

describe("groundImport — fast-path resolver", () => {
  it("fast-paths a row with strong, unanimous history (>= 3 matches, 100% agreement)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS #998" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5) }),
    );

    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.merchant).toBe("Whole Foods");
    expect(r.categoryId).toBe("cat-groceries");
    expect(r.categoryConfidence).toBe("high");
  });

  it("does NOT fast-path below the minimum match count (2 < 3)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 2) }),
    );
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("fast-paths at exactly 3 matches with 100% agreement (lower boundary)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 3) }),
    );
    expect(results.get("r1")!.resolution).toBe("fast-path");
  });

  it("fast-paths at exactly 80% category agreement (4 of 5)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 4),
      makeTransaction({
        id: "wf-dissent",
        merchant: "Whole Foods",
        note: "WHOLE FOODS",
        categoryId: "cat-dining",
        datetime: "2025-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-groceries");
  });

  it("does NOT fast-path below 80% agreement (3 of 5 = 60%)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 3),
      makeTransaction({ id: "d1", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-dining" }),
      makeTransaction({ id: "d2", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("agreement counts uncategorized matches against unanimity", () => {
    // 3 categorized (groceries) + 2 with no/invalid category = 3/5 = 60% < 80%.
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 3),
      makeTransaction({ id: "u1", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "" }),
      makeTransaction({ id: "u2", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "gone-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("honors tunable thresholds via options", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 2) }),
      { minMatches: 2 },
    );
    expect(results.get("r1")!.resolution).toBe("fast-path");
  });

  it("never fast-paths a transfer row", () => {
    const row = makeImportTransaction({ id: "r1", type: "transfer", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5) }),
    );
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });
});

// ── Context sidecar (top-3 + stats distiller) ────────────────────

describe("groundImport — context sidecar", () => {
  it("attaches the top-3 most-recent examples", () => {
    const history = [
      makeTransaction({ id: "old", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2024-01-15T00:00:00.000" }),
      makeTransaction({ id: "mid", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2025-06-15T00:00:00.000" }),
      makeTransaction({ id: "new", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2026-01-15T00:00:00.000" }),
      makeTransaction({ id: "oldest", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2023-01-15T00:00:00.000" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "GINGER 0421" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.examples.length).toBe(3);
    // Most-recent first.
    expect(ctx.examples.map((e) => e.date)).toEqual(["2026-01-15", "2025-06-15", "2024-01-15"]);
  });

  it("distills merchant counts (the Ginger example)", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "Ginger", note: "ZELLE GINGER", categoryId: "cat-rent" }),
      makeTransaction({ id: "2", merchant: "Ginger", note: "ZELLE GINGER", categoryId: "cat-rent" }),
      makeTransaction({ id: "3", merchant: "Ginger Zelle", note: "GINGER ZELLE", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ZELLE GINGER" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.merchantStats).toEqual([
      { name: "Ginger", count: 2 },
      { name: "Ginger Zelle", count: 1 },
    ]);
  });

  it("distills category counts (Rent x22, Housekeeping x3 shape)", () => {
    const history = [
      ...historyFor("Acme Property", "cat-rent", 22),
      ...historyFor("Acme Property", "cat-dining", 3),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME PROPERTY" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.categoryStats[0]).toEqual({ name: "cat-rent", count: 22 });
    expect(ctx.categoryStats[1]).toEqual({ name: "cat-dining", count: 3 });
  });

  it("excludes invalid/archived category ids from category stats", () => {
    const history = [
      ...historyFor("Acme", "cat-rent", 3),
      makeTransaction({ id: "x", merchant: "Acme", note: "ACME", categoryId: "deleted-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const names = context.get("r1")!.categoryStats.map((c) => c.name);
    expect(names).not.toContain("deleted-cat");
  });

  it("writes no context entry for a row with no history match", () => {
    const row = makeImportTransaction({ id: "r1", description: "BRAND NEW MERCHANT" });
    const { context } = groundImport(input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 3) }));
    expect(context.has("r1")).toBe(false);
  });

  it("omits empty example fields rather than carrying them as empty strings", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "", note: "ACME", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const example = context.get("r1")!.examples[0];
    expect(example).not.toHaveProperty("merchant");
    expect(example.note).toBe("ACME");
    expect(example.categoryId).toBe("cat-rent");
  });

  it("drops a dead/archived category id from an example (never shown as unknown)", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "Acme", note: "ACME", categoryId: "deleted-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const example = context.get("r1")!.examples[0];
    expect(example).not.toHaveProperty("categoryId");
    expect(example.merchant).toBe("Acme");
  });
});

// ── sourceAccount resolution + sourceCategory non-backfill ───────

describe("groundImport — sourceAccount resolution", () => {
  it("resolves sourceAccount to a budget account by name", () => {
    const row = makeImportTransaction({ id: "r1", sourceAccount: "Chase Checking" });
    const { results } = groundImport(input({ rows: [row] }));
    expect(results.get("r1")!.accountId).toBe("acct-checking");
  });

  it("prefers an explicit account alias over name matching", () => {
    const row = makeImportTransaction({ id: "r1", sourceAccount: "CHK-9988" });
    const { results } = groundImport(
      input({ rows: [row], accountMapping: { "CHK-9988": "acct-checking" } }),
    );
    expect(results.get("r1")!.accountId).toBe("acct-checking");
  });
});

// ── Payment-leg recognition (deterministic retype) ───────────────

describe("groundImport — payment-leg recognition", () => {
  const APPLE_CARD = makeAccount({ id: "acct-apple", name: "🍏 Apple Card", type: "credit" });
  const CAPITAL_ONE = makeAccount({ id: "acct-capone", name: "🛒 Capital One BJ's", type: "credit" });
  const BOFA_CHECKING = makeAccount({ id: "acct-bofa-chk", name: "🏦 BofA Checking" });
  const accounts = [APPLE_CARD, CAPITAL_ONE, BOFA_CHECKING];

  it("retypes an outflow card payment to transfer with the counterpart prefilled", () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "APPLECARD GSBANK DES:PAYMENT ID:M1234",
      amount: -50000,
      type: "expense",
      sourceAccount: "BofA Checking",
    });
    const { results, stats } = groundImport(input({ rows: [row], accounts }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("payment-leg");
    expect(r.type).toBe("transfer");
    expect(r.targetAccountId).toBe("acct-apple");
    expect(r.accountId).toBe("acct-bofa-chk");
    // Transfer treatment: no merchant, no category.
    expect(r.merchant).toBe("");
    expect(r.categoryId).toBe("");
    // Counterpart prefilled = no classifier needed → counts as resolved.
    expect(stats.resolved).toBe(1);
    expect(stats.ambiguous).toBe(0);
  });

  it("leaves an inflow untouched (a card refund is not a payment leg)", () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "CAPITAL ONE DES:MOBILE PMT ID:X99887",
      amount: 50000,
      type: "income",
      sourceAccount: "BofA Checking",
    });
    const { results } = groundImport(input({ rows: [row], accounts }));

    const r = results.get("r1")!;
    expect(r.type).toBeUndefined();
    expect(r.targetAccountId).toBeUndefined();
  });

  it("leaves a keyword-only outflow untouched (no account named)", () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "Zelle payment to Dima Evdokimov",
      amount: -20000,
      type: "expense",
      sourceAccount: "BofA Checking",
    });
    const { results } = groundImport(input({ rows: [row], accounts }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.type).toBeUndefined();
  });

  it("composes with dedup: a payment row duplicating an existing transfer leg stays a transfer", () => {
    // The card payment was already merged once — its outflow leg exists on the
    // checking account. A re-import must stage as transfer + duplicate with the
    // counterpart filled, so a user override-merging it creates a proper pair.
    const history = transferLegs("acct-bofa-chk", "acct-capone", "2026-03-01T00:00:00.000", "pay");
    history[0].note = "CAPITAL ONE DES:MOBILE PMT";
    const row = makeImportTransaction({
      id: "r1",
      description: "CAPITAL ONE DES:MOBILE PMT",
      amount: -50000,
      date: "2026-03-01",
      type: "expense",
      sourceAccount: "BofA Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.duplicateConfidence).toBe("high");
    expect(r.type).toBe("transfer");
    expect(r.targetAccountId).toBe("acct-capone");
  });

  it("a dup match never writes merchant/category onto a retyped transfer", () => {
    // The user once hand-logged this payment as a categorized expense. The dup
    // flag carries, but a transfer takes neither the merchant nor the category.
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "Capital One",
      note: "Card payment (manual)",
      categoryId: "cat-dining",
      accountId: "acct-bofa-chk",
      amount: -50000,
      datetime: "2026-03-01T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "CAPITAL ONE DES:MOBILE PMT",
      amount: -50000,
      date: "2026-03-01",
      type: "expense",
      sourceAccount: "BofA Checking",
    });
    const { results } = groundImport(input({ rows: [row], history: [existing], accounts }));

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.type).toBe("transfer");
    expect(r.targetAccountId).toBe("acct-capone");
    expect(r.merchant).toBe("");
    expect(r.categoryId).toBe("");
  });
});

// ── Transfer context: the imported account's direction-aware history ──

describe("groundImport — transfer context sidecar", () => {
  const accounts = [CHECKING, SAVINGS, BROKERAGE];

  /** An inflow transfer row landing on the imported account (needs a "from"). */
  const inflowRow = makeImportTransaction({
    id: "r1", type: "transfer", description: "ACH BOFA SAV 123",
    amount: 50000, sourceAccount: "Chase Checking",
  });
  /** An outflow transfer row leaving the imported account (needs a "to"). */
  const outflowRow = makeImportTransaction({
    id: "r1", type: "transfer", description: "ONLINE TRANSFER",
    amount: -50000, sourceAccount: "Chase Checking",
  });

  it("an inflow row carries the account's incoming legs by counterpart NAME", () => {
    // Two past transfers INTO Checking, from Savings then Brokerage.
    const history = [
      ...transferLegs("acct-savings", "acct-checking", "2025-12-10T00:00:00.000", "a", 30000),
      ...transferLegs("acct-brokerage", "acct-checking", "2025-12-20T00:00:00.000", "b", 40000),
    ];
    const { transferContext } = groundImport(input({ rows: [inflowRow], history, accounts }));

    const ctx = transferContext.get("r1")!;
    expect(ctx.recentTransfers).toEqual([
      { account: "Ally Savings", amount: 30000 },
      { account: "Fidelity Brokerage", amount: 40000 },
    ]);
    expect(ctx.topAccounts).toEqual([
      { account: "Ally Savings", count: 1 },
      { account: "Fidelity Brokerage", count: 1 },
    ]);
  });

  it("an outflow row uses the account's outgoing legs", () => {
    // A transfer OUT of Checking → Savings; the incoming leg below is ignored.
    const history = [
      ...transferLegs("acct-checking", "acct-savings", "2025-12-15T00:00:00.000", "out"),
      ...transferLegs("acct-brokerage", "acct-checking", "2025-12-16T00:00:00.000", "in"),
    ];
    const { transferContext } = groundImport(input({ rows: [outflowRow], history, accounts }));

    const ctx = transferContext.get("r1")!;
    expect(ctx.recentTransfers).toEqual([{ account: "Ally Savings", amount: -50000 }]);
    expect(ctx.topAccounts).toEqual([{ account: "Ally Savings", count: 1 }]);
  });

  it("recentTransfers are chronological, windowed to 2 months, capped at 10", () => {
    // 14 weekly inflows from Savings spanning ~3.5 months (amount encodes order),
    // plus one stale Brokerage leg well before the window. The window anchors to
    // the newest leg (2026-06-18): only legs on/after 2026-04-18 survive, the cap
    // keeps the last 10, and order is chronological (ascending date).
    const weekly = Array.from({ length: 14 }, (_, i) => {
      const day = new Date("2026-03-12T00:00:00.000");
      day.setDate(day.getDate() + i * 7);
      return transferLegs("acct-savings", "acct-checking", day.toISOString(), `w${i}`, 1000 + i);
    }).flat();
    const stale = transferLegs("acct-brokerage", "acct-checking", "2026-01-01T00:00:00.000", "stale", 77000);
    const { transferContext } = groundImport(
      input({ rows: [inflowRow], history: [...weekly, ...stale], accounts }),
    );

    const ctx = transferContext.get("r1")!;
    expect(ctx.recentTransfers.length).toBeLessThanOrEqual(10); // capped
    // The stale Brokerage leg is outside the 2-month window; survivors are Savings.
    expect(ctx.recentTransfers.every((t) => t.account === "Ally Savings")).toBe(true);
    // Chronological: amounts encode insertion order, so they're strictly ascending.
    const amounts = ctx.recentTransfers.map((t) => t.amount);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
    expect(amounts[amounts.length - 1]).toBe(1013); // the newest (14th) leg
  });

  it("caps recentTransfers at 10, keeping the most recent", () => {
    // 15 daily inflows within one month — all in-window, so the cap (10) bites
    // and keeps the newest 10 (amounts 1005..1014), chronological.
    const daily = Array.from({ length: 15 }, (_, i) => {
      const day = new Date("2026-06-01T00:00:00.000");
      day.setDate(day.getDate() + i);
      return transferLegs("acct-savings", "acct-checking", day.toISOString(), `d${i}`, 1000 + i);
    }).flat();
    const { transferContext } = groundImport(input({ rows: [inflowRow], history: daily, accounts }));

    const amounts = transferContext.get("r1")!.recentTransfers.map((t) => t.amount);
    expect(amounts).toEqual([1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014]);
  });

  it("topAccounts ranks the top-3 counterparts by count, names not ids", () => {
    // Four counterparts (Checking → Savings ×3, Brokerage ×2, Cash ×1, Loan ×1):
    // only the top 3 by count survive, count desc then name asc.
    const cash = makeAccount({ id: "acct-cash", name: "Wallet Cash", type: "cash" });
    const loan = makeAccount({ id: "acct-loan", name: "Car Loan", type: "loan" });
    const history = [
      ...transferLegs("acct-checking", "acct-savings", "2026-06-01T00:00:00.000", "s1"),
      ...transferLegs("acct-checking", "acct-savings", "2026-06-02T00:00:00.000", "s2"),
      ...transferLegs("acct-checking", "acct-savings", "2026-06-03T00:00:00.000", "s3"),
      ...transferLegs("acct-checking", "acct-brokerage", "2026-06-04T00:00:00.000", "b1"),
      ...transferLegs("acct-checking", "acct-brokerage", "2026-06-05T00:00:00.000", "b2"),
      ...transferLegs("acct-checking", "acct-cash", "2026-06-06T00:00:00.000", "c1"),
      ...transferLegs("acct-checking", "acct-loan", "2026-06-07T00:00:00.000", "l1"),
    ];
    const { transferContext } = groundImport(
      input({ rows: [outflowRow], history, accounts: [...accounts, cash, loan] }),
    );

    expect(transferContext.get("r1")!.topAccounts).toEqual([
      { account: "Ally Savings", count: 3 },
      { account: "Fidelity Brokerage", count: 2 },
      { account: "Car Loan", count: 1 }, // tie at 1 broken by name asc (Car < Wallet)
    ]);
  });

  it("attaches no context when the account has no matching-direction history", () => {
    // Only OUTGOING legs exist, but the row is an INFLOW → no incoming legs.
    const history = transferLegs("acct-checking", "acct-savings", "2026-06-01T00:00:00.000", "out");
    const { transferContext } = groundImport(input({ rows: [inflowRow], history, accounts }));
    expect(transferContext.has("r1")).toBe(false);
  });

  it("attaches no context when the account has no transfer history at all", () => {
    const { transferContext } = groundImport(input({ rows: [inflowRow], history: [], accounts }));
    expect(transferContext.has("r1")).toBe(false);
  });

  it("drops a leg whose counterpart account is archived or gone", () => {
    // The paired leg lives on acct-gone, absent from the active accounts list.
    const history = transferLegs("acct-gone", "acct-checking", "2026-06-01T00:00:00.000", "g");
    const { transferContext } = groundImport(input({ rows: [inflowRow], history, accounts }));
    expect(transferContext.has("r1")).toBe(false);
  });

  it("ignores non-transfer history when building transfer context", () => {
    const history = [
      makeTransaction({
        id: "e1", type: "income", merchant: "Acme", note: "DEPOSIT",
        accountId: "acct-checking", categoryId: "", amount: 50000,
        datetime: "2026-06-01T00:00:00.000",
      }),
    ];
    const { transferContext } = groundImport(input({ rows: [inflowRow], history, accounts }));
    expect(transferContext.has("r1")).toBe(false);
  });

  it("non-transfer rows never get transfer context", () => {
    const row = makeImportTransaction({ id: "r1", type: "expense", description: "WHOLE FOODS" });
    const { transferContext } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5), accounts }),
    );
    expect(transferContext.has("r1")).toBe(false);
  });

  it("grounding no longer sets targetAccountId — the model decides it", () => {
    const history = transferLegs("acct-savings", "acct-checking", "2026-06-01T00:00:00.000", "a");
    const { results } = groundImport(input({ rows: [inflowRow], history, accounts }));
    // The result type no longer carries targetAccountId at all; applyGrounding
    // therefore leaves the staged row's value untouched (the enrichment writes it).
    expect("targetAccountId" in results.get("r1")!).toBe(false);
  });
});

describe("groundImport — sourceCategory is never backfilled", () => {
  it('does NOT assign "Other Income" from the bank\'s coarse "Other" label', () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "UNKNOWN MERCHANT XYZ",
      type: "expense",
      sourceCategory: "Other",
    });
    const { results } = groundImport(input({ rows: [row] }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
    expect(r.categoryConfidence).toBe("");
  });

  it("leaves a row with a specific sourceCategory ambiguous (the model decides)", () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "UNKNOWN MERCHANT XYZ",
      sourceCategory: "Groceries",
    });
    const { results } = groundImport(input({ rows: [row] }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
    expect(r.merchant).toBe("");
  });

  it("leaves a truly ambiguous row ambiguous", () => {
    const row = makeImportTransaction({ id: "r1", description: "MYSTERY CHARGE", sourceCategory: "" });
    const { results } = groundImport(input({ rows: [row] }));
    expect(results.get("r1")!.resolution).toBe("ambiguous");
  });
});

// ── Type guard on deterministic assignments ──────────────────────

describe("groundImport — type guard", () => {
  it("does NOT fast-path an expense into an Income-group category, even with dominant history", () => {
    // A TurboTax refund the user once filed as income shouldn't pull a TurboTax
    // expense into Other Income — the row goes to the model instead.
    const row = makeImportTransaction({ id: "r1", description: "TURBOTAX", type: "expense" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("TurboTax", "cat-income", 5) }),
    );
    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
  });

  it("fast-paths an income row into an Income-group category", () => {
    const row = makeImportTransaction({ id: "r1", description: "ACME PAYROLL", type: "income" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Acme Payroll", "cat-income", 5) }),
    );
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-income");
  });

  it("does NOT fast-path an income row into an expense category", () => {
    const row = makeImportTransaction({ id: "r1", description: "ACME DEPOSIT", type: "income" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Acme Deposit", "cat-groceries", 5) }),
    );
    expect(results.get("r1")!.resolution).toBe("ambiguous");
  });

  it("ignores wrong-type history but still fast-paths on a type-correct majority", () => {
    // 4 expense-category matches + 1 income-category dissenter = 4/5 = 80%.
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 4),
      makeTransaction({
        id: "wf-income",
        merchant: "Whole Foods",
        note: "WHOLE FOODS",
        categoryId: "cat-income",
        datetime: "2025-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS", type: "expense" });
    const { results } = groundImport(input({ rows: [row], history }));
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-groceries");
  });
});

// ── Duplicate folding ────────────────────────────────────────────

describe("groundImport — duplicate folding", () => {
  function dupSetup(): {
    rows: ImportTransaction[];
    history: Transaction[];
    accounts: Account[];
    categories: Category[];
  } {
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "Whole Foods",
      note: "WHOLE FOODS #998",
      categoryId: "cat-groceries",
      accountId: "acct-checking",
      amount: -4550,
      datetime: "2026-01-15T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "WHOLE FOODS #998",
      amount: -4550,
      date: "2026-01-15",
      sourceAccount: "Chase Checking",
    });
    return {
      rows: [row],
      history: [existing],
      accounts: [CHECKING],
      categories: [GROCERIES, RENT, DINING],
    };
  }

  it("marks an exact re-import as a duplicate and carries merchant + category", () => {
    const { results } = groundImport(dupSetup());
    const r = results.get("r1")!;
    expect(r.resolution).toBe("duplicate");
    expect(r.duplicate).toBe(true);
    expect(r.duplicateConfidence).toBe("high");
    expect(r.merchant).toBe("Whole Foods");
    expect(r.categoryId).toBe("cat-groceries");
    expect(r.duplicateMatch?.existingTransactionId).toBe("ex-1");
  });

  it("counts a duplicate as resolved (skips enrichment) in stats", () => {
    const { stats } = groundImport(dupSetup());
    expect(stats.duplicates).toBe(1);
    expect(stats.resolved).toBe(1);
  });

  it("grounds a relaxed-window match at low duplicateConfidence", () => {
    // Same amount + account, dates two days apart, descriptions diverge — only
    // rule 5 fires, and the preview needs to know this dup is speculative.
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "",
      note: "MONTHLY SAVINGS MOVE",
      categoryId: "",
      accountId: "acct-checking",
      amount: -50000,
      datetime: "2026-01-17T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "ACH WITHDRAWAL 9981",
      amount: -50000,
      date: "2026-01-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history: [existing] }));

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.duplicateConfidence).toBe("low");
  });

  it("leaves duplicateConfidence empty on a non-duplicate row", () => {
    const row = makeImportTransaction({ id: "r1", description: "ZZZ MYSTERY" });
    const { results } = groundImport(input({ rows: [row] }));

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(false);
    expect(r.duplicateConfidence).toBe("");
  });

  it("dedup leverages the fast-path-resolved merchant even when descriptions diverge", () => {
    const history = [
      ...historyFor("Ginger", "cat-rent", 3), // makes the row fast-path to "Ginger"
      makeTransaction({
        id: "ex-dup",
        merchant: "Ginger",
        note: "GINGER 0315 OLD-REF",
        categoryId: "cat-rent",
        accountId: "acct-checking",
        amount: -150000,
        datetime: "2026-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({
      id: "r1",
      description: "GINGER 0421 NEW-REF-9988",
      amount: -150000,
      date: "2026-02-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history, accounts: [CHECKING], categories: [GROCERIES, RENT, DINING] }),
    );
    expect(results.get("r1")!.duplicate).toBe(true);
  });

  it("keeps the fast-pathed category when the matched dup has an empty categoryId", () => {
    // Row fast-paths to Ginger/cat-rent from history, then matches a duplicate
    // existing txn that itself is uncategorized. The dup flag must not clobber
    // the category code already resolved. 4 categorized + 1 uncategorized dup =
    // 80% agreement, so the row still fast-paths before dedup runs.
    const history = [
      ...historyFor("Ginger", "cat-rent", 4),
      makeTransaction({
        id: "ex-dup",
        merchant: "Ginger",
        note: "GINGER",
        categoryId: "", // uncategorized existing transaction
        accountId: "acct-checking",
        amount: -150000,
        datetime: "2026-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({
      id: "r1",
      description: "GINGER 0421",
      amount: -150000,
      date: "2026-02-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history, accounts: [CHECKING], categories: [GROCERIES, RENT, DINING] }),
    );

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.categoryId).toBe("cat-rent"); // fast-path category survives
    expect(r.categoryConfidence).toBe("high"); // and its confidence
    expect(r.merchant).toBe("Ginger");
  });

  it("does NOT carry a wrong-type category from a matched dup (keeps the merchant)", () => {
    // The existing txn this expense duplicates was miscategorized as income —
    // carry its merchant for display, but never its income category.
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "TurboTax",
      note: "TURBOTAX FEE",
      categoryId: "cat-income", // wrong type for an expense
      accountId: "acct-checking",
      amount: -8900,
      datetime: "2026-01-15T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "TURBOTAX FEE",
      type: "expense",
      amount: -8900,
      date: "2026-01-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history: [existing] }),
    );

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.merchant).toBe("TurboTax"); // merchant carried for display
    expect(r.categoryId).toBe(""); // income category NOT carried
    expect(r.categoryConfidence).toBe(""); // and no high confidence on it
  });
});

// ── Stats ────────────────────────────────────────────────────────

describe("groundImport — stats", () => {
  it("tallies total / fastPathed / ambiguous / resolved across rows", () => {
    const rows = [
      makeImportTransaction({ id: "fast", description: "WHOLE FOODS" }),
      makeImportTransaction({ id: "ambig", description: "ZZZ MYSTERY" }),
      makeImportTransaction({ id: "cat", description: "QQQ UNKNOWN", sourceCategory: "Groceries" }),
    ];
    const { stats } = groundImport(
      input({ rows, history: historyFor("Whole Foods", "cat-groceries", 4) }),
    );
    expect(stats.total).toBe(3);
    expect(stats.fastPathed).toBe(1);
    // The sourceCategory hint is no longer backfilled — both non-fast-path rows
    // are ambiguous and go to the classifier.
    expect(stats.ambiguous).toBe(2);
    expect(stats.resolved).toBe(1);
  });

  it("indexes history once and grounds many rows (performance shape)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 50),
      ...historyFor("Acme Rent", "cat-rent", 50),
    ];
    const rows = Array.from({ length: 200 }, (_, i) =>
      makeImportTransaction({
        id: `r${i}`,
        description: i % 2 === 0 ? "WHOLE FOODS MARKET" : "ACME RENT PAYMENT",
      }),
    );
    const { results, stats } = groundImport(input({ rows, history }));
    expect(results.size).toBe(200);
    expect(stats.fastPathed).toBe(200);
  });
});
