import { describe, it, expect } from "vitest";
import { makeAccount, makeCategory, makeTransaction as makeTxn } from "../test-factories";
import { matchesMoney, matchesTransaction, searchTransactions } from "./search";

// Shared name-resolution context. `acc-1` → "Chase Checking", `cat-1` →
// "Groceries"; rows reference these so name-field matching has something to
// resolve against.
const accounts = [
  makeAccount({ id: "acc-1", name: "Chase Checking" }),
  makeAccount({ id: "acc-2", name: "Amex Gold" }),
];
const categories = [
  makeCategory({ id: "cat-1", name: "Groceries" }),
  makeCategory({ id: "cat-2", name: "Dining Out" }),
];
const ctx = { accounts, categories };

function match(txn: Parameters<typeof matchesTransaction>[0], query: string) {
  return matchesTransaction(txn, query, ctx);
}

// ── matchesMoney (the fuzzy amount predicate) ───────────────────────────

describe("matchesMoney", () => {
  // Matching is on the number, not the display string — currency-agnostic. The
  // amount renders symbol-free ("1,850.00"); a stray currency symbol in the
  // query is stripped, so "$1,850.00" still hits, but it's the digits matching,
  // not the "$".
  it("matches the full grouped two-decimal form", () => {
    expect(matchesMoney(185000, "1,850.00")).toBe(true);
    expect(matchesMoney(185000, "1850.00")).toBe(true);
  });

  it("ignores a stray currency symbol in the query", () => {
    expect(matchesMoney(185000, "$1,850.00")).toBe(true);
    expect(matchesMoney(185000, "$1850")).toBe(true);
  });

  it("matches without commas", () => {
    expect(matchesMoney(185000, "1850")).toBe(true);
  });

  it("matches the comma'd whole-number chunk", () => {
    expect(matchesMoney(185000, "1,850")).toBe(true);
  });

  it("matches a partial fragment of the amount (290 → 290.00)", () => {
    expect(matchesMoney(29000, "290")).toBe(true);
  });

  it("matches the documented headline example: 29 → 1.29 and 290", () => {
    expect(matchesMoney(129, "29")).toBe(true); // "1.29" contains "29"
    expect(matchesMoney(29000, "29")).toBe(true); // "290.00" contains "29"
  });

  it("matches the dotted form of a sub-unit amount (1.29)", () => {
    expect(matchesMoney(129, "1.29")).toBe(true);
    // The decimal point breaks the digit run, so a dotless "129" does NOT
    // match 1.29 — the substring "129" never appears in "1.29".
    expect(matchesMoney(129, "129")).toBe(false);
  });

  it("matches the cents portion", () => {
    expect(matchesMoney(1299, "99")).toBe(true);
  });

  it("matches negative amounts via the leading minus", () => {
    expect(matchesMoney(-1250, "-12")).toBe(true);
    expect(matchesMoney(-1250, "-$12.50")).toBe(true);
  });

  it("matches the digits of a negative amount without the sign", () => {
    expect(matchesMoney(-1250, "12.50")).toBe(true);
  });

  it("does not match an amount that isn't present", () => {
    expect(matchesMoney(185000, "9999")).toBe(false);
  });

  it("does not money-match a query with no digits", () => {
    // A non-numeric query (letters, or a bare sign) must never money-match —
    // otherwise "-anything" would hit every negative amount.
    expect(matchesMoney(-8500, "zzz-nope")).toBe(false);
    expect(matchesMoney(-8500, "-")).toBe(false);
  });
});

// ── matchesTransaction: each searched field ─────────────────────────────

describe("matchesTransaction — searched fields", () => {
  it("matches on merchant (case-insensitive substring)", () => {
    const t = makeTxn({ merchant: "Whole Foods Market" });
    expect(match(t, "whole foods")).toBe(true);
    expect(match(t, "WHOLE")).toBe(true);
    expect(match(t, "market")).toBe(true);
  });

  it("matches on note (raw bank description)", () => {
    const t = makeTxn({ merchant: "Apple", note: "APL*ITUNES 866-712-7753" });
    expect(match(t, "itunes")).toBe(true);
    expect(match(t, "866-712")).toBe(true);
  });

  it("matches on category name", () => {
    const t = makeTxn({ categoryId: "cat-2", merchant: "Nobu" });
    expect(match(t, "dining")).toBe(true);
    expect(match(t, "DINING OUT")).toBe(true);
  });

  it("matches on account name", () => {
    const t = makeTxn({ accountId: "acc-2", merchant: "Nobu" });
    expect(match(t, "amex")).toBe(true);
    expect(match(t, "gold")).toBe(true);
  });

  it("matches on money amount", () => {
    const t = makeTxn({ amount: -185000, merchant: "Rent Co" });
    expect(match(t, "1850")).toBe(true);
    expect(match(t, "$1,850.00")).toBe(true);
  });

  it("resolves an empty categoryId to 'uncategorized' for text matching", () => {
    const t = makeTxn({ categoryId: "", merchant: "Mystery" });
    expect(match(t, "uncategorized")).toBe(true);
  });

  it("resolves an unknown categoryId to 'uncategorized' too", () => {
    const t = makeTxn({ categoryId: "cat-deleted", merchant: "Mystery" });
    expect(match(t, "uncategorized")).toBe(true);
  });
});

// ── matchesTransaction: query handling ──────────────────────────────────

describe("matchesTransaction — query handling", () => {
  it("matches everything on an empty query", () => {
    expect(match(makeTxn({ merchant: "Anything" }), "")).toBe(true);
  });

  it("matches everything on a whitespace-only query", () => {
    expect(match(makeTxn({ merchant: "Anything" }), "   ")).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    const t = makeTxn({ merchant: "Costco" });
    expect(match(t, "  costco  ")).toBe(true);
  });

  it("is case-insensitive", () => {
    const t = makeTxn({ merchant: "Costco" });
    expect(match(t, "COSTCO")).toBe(true);
  });

  it("returns false when no field matches", () => {
    const t = makeTxn({
      merchant: "Costco",
      note: "warehouse",
      categoryId: "cat-1",
      accountId: "acc-1",
      amount: -5000,
    });
    expect(match(t, "zzz-nope")).toBe(false);
  });
});

// ── searchTransactions (filter convenience) ─────────────────────────────

describe("searchTransactions", () => {
  const txns = [
    makeTxn({ id: "t-wf", merchant: "Whole Foods", categoryId: "cat-1", accountId: "acc-1", amount: -8500 }),
    makeTxn({ id: "t-nobu", merchant: "Nobu", categoryId: "cat-2", accountId: "acc-2", amount: -22000 }),
    makeTxn({ id: "t-apple", merchant: "Apple", note: "APL*ITUNES", categoryId: "cat-2", accountId: "acc-1", amount: -999 }),
  ];

  it("returns only matching rows", () => {
    const out = searchTransactions(txns, "nobu", ctx);
    expect(out.map((t) => t.id)).toEqual(["t-nobu"]);
  });

  it("matches across fields in a single pass (category name spans two rows)", () => {
    const out = searchTransactions(txns, "dining", ctx);
    expect(out.map((t) => t.id).sort()).toEqual(["t-apple", "t-nobu"]);
  });

  it("matches on the raw note", () => {
    const out = searchTransactions(txns, "itunes", ctx);
    expect(out.map((t) => t.id)).toEqual(["t-apple"]);
  });

  it("matches on a money fragment", () => {
    const out = searchTransactions(txns, "220", ctx);
    expect(out.map((t) => t.id)).toEqual(["t-nobu"]);
  });

  it("returns the input unchanged on an empty query", () => {
    expect(searchTransactions(txns, "", ctx)).toBe(txns);
  });

  it("returns the input unchanged on a whitespace query", () => {
    expect(searchTransactions(txns, "  ", ctx)).toBe(txns);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchTransactions(txns, "zzz-nope", ctx)).toEqual([]);
  });
});
