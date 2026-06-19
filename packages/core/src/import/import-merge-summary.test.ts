import { describe, it, expect } from "vitest";
import { makeAccount, makeTransaction } from "@capybudget/core/test-factories";
import { summarizeMerge } from "./import-merge-summary";
import type { ImportTransaction } from "./import-types";

function makeImportTxn(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-03-15",
    description: "GROCERY STORE #123",
    amount: -2500,
    type: "expense",
    sourceAccount: "Chase Checking",
    sourceCategory: "Groceries",
    merchant: "Grocery Store",
    accountId: "",
    targetAccountId: "",
    categoryId: "cat-1",
    categoryConfidence: "high",
    duplicate: false,
    duplicateConfidence: "",
    ...overrides,
  };
}

describe("summarizeMerge", () => {
  it("summarizes a single source into an existing account", () => {
    const acct = makeAccount({ id: "acct-1", name: "My Chase", type: "checking" });
    const existing = makeTransaction({ accountId: "acct-1", amount: 10000 });
    const txn = makeImportTxn({ sourceAccount: "Chase Checking", amount: -2500 });

    const rows = summarizeMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [acct],
      [existing],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: "acct-1",
      accountName: "My Chase",
      accountType: "checking",
      isNew: false,
      sourceAccounts: ["Chase Checking"],
      count: 1,
      delta: -2500,
      currentBalance: 10000,
      resultingBalance: 7500,
    });
  });

  it("reports a newly created account with zero current balance", () => {
    const txn = makeImportTxn({ sourceAccount: "New Bank", amount: -3000 });

    const rows = summarizeMerge(
      { transactions: [txn], selectedIds: new Set([txn.id]), accountMapping: {} },
      [],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountName: "New Bank",
      isNew: true,
      sourceAccounts: ["New Bank"],
      count: 1,
      delta: -3000,
      currentBalance: 0,
      resultingBalance: -3000,
    });
  });

  it("merges two sources mapped to one account", () => {
    const acct = makeAccount({ id: "acct-1", name: "Wallet", type: "cash" });
    const a = makeImportTxn({ sourceAccount: "Cash A", amount: -1000 });
    const b = makeImportTxn({ sourceAccount: "Cash B", amount: 4000, type: "income" });

    const rows = summarizeMerge(
      {
        transactions: [a, b],
        selectedIds: new Set([a.id, b.id]),
        accountMapping: { "Cash A": "acct-1", "Cash B": "acct-1" },
      },
      [acct],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: "acct-1",
      sourceAccounts: ["Cash A", "Cash B"],
      count: 2,
      delta: 3000,
      currentBalance: 0,
      resultingBalance: 3000,
    });
  });

  it("includes the transfer-target account even when it isn't a source", () => {
    const checking = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const savings = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // Single-leg transfer: $500 leaves Checking, lands in Savings (the target,
    // which is never named as an import source).
    const transfer = makeImportTxn({
      sourceAccount: "Checking",
      type: "transfer",
      amount: -50000,
      targetAccountId: "acct-sav",
      categoryId: "",
    });

    const rows = summarizeMerge(
      {
        transactions: [transfer],
        selectedIds: new Set([transfer.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [checking, savings],
      [],
    );

    const byId = Object.fromEntries(rows.map((r) => [r.accountId, r]));
    expect(rows).toHaveLength(2);

    expect(byId["acct-chk"]).toMatchObject({
      sourceAccounts: ["Checking"],
      count: 1,
      delta: -50000,
      resultingBalance: -50000,
    });

    // The target leg lands on Savings with no attributed source.
    expect(byId["acct-sav"]).toMatchObject({
      sourceAccounts: [],
      count: 1,
      delta: 50000,
      resultingBalance: 50000,
    });
  });

  it("pairs a two-leg transfer across two accounts", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // YNAB-style: two transfer rows, opposite amounts, same date, paired on merge.
    const out = makeImportTxn({
      sourceAccount: "Checking",
      type: "transfer",
      amount: -20000,
      categoryId: "",
    });
    const inn = makeImportTxn({
      sourceAccount: "Savings",
      type: "transfer",
      amount: 20000,
      categoryId: "",
    });

    const rows = summarizeMerge(
      {
        transactions: [out, inn],
        selectedIds: new Set([out.id, inn.id]),
        accountMapping: { Checking: "acct-chk", Savings: "acct-sav" },
      },
      [chk, sav],
      [],
    );

    const byId = Object.fromEntries(rows.map((r) => [r.accountId, r]));
    expect(byId["acct-chk"]).toMatchObject({ delta: -20000, count: 1, sourceAccounts: ["Checking"] });
    expect(byId["acct-sav"]).toMatchObject({ delta: 20000, count: 1, sourceAccounts: ["Savings"] });
  });

  it("balance math holds: currentBalance + delta = resultingBalance", () => {
    const acct = makeAccount({ id: "acct-1", name: "Card", type: "credit_card" });
    const existing = [
      makeTransaction({ accountId: "acct-1", amount: -5000 }),
      makeTransaction({ accountId: "acct-1", amount: -1500 }),
    ];
    const txns = [
      makeImportTxn({ sourceAccount: "Card", amount: -2000 }),
      makeImportTxn({ sourceAccount: "Card", amount: 3000, type: "income" }),
    ];

    const rows = summarizeMerge(
      {
        transactions: txns,
        selectedIds: new Set(txns.map((t) => t.id)),
        accountMapping: { Card: "acct-1" },
      },
      [acct],
      existing,
    );

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.currentBalance).toBe(-6500);
    expect(row.delta).toBe(1000);
    expect(row.resultingBalance).toBe(-5500);
    expect(row.currentBalance + row.delta).toBe(row.resultingBalance);
  });

  it("only counts selected transactions", () => {
    const acct = makeAccount({ id: "acct-1", name: "Bank", type: "checking" });
    const selected = makeImportTxn({ sourceAccount: "Bank", amount: -1000 });
    const skipped = makeImportTxn({ sourceAccount: "Bank", amount: -9999 });

    const rows = summarizeMerge(
      {
        transactions: [selected, skipped],
        selectedIds: new Set([selected.id]),
        accountMapping: { Bank: "acct-1" },
      },
      [acct],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1, delta: -1000 });
  });

  it("sorts new accounts first, then by count descending", () => {
    const existing = makeAccount({ id: "acct-existing", name: "Existing", type: "checking" });
    const txns = [
      makeImportTxn({ sourceAccount: "Existing", amount: -100 }),
      makeImportTxn({ sourceAccount: "Existing", amount: -200 }),
      makeImportTxn({ sourceAccount: "Fresh", amount: -300 }),
    ];

    const rows = summarizeMerge(
      {
        transactions: txns,
        selectedIds: new Set(txns.map((t) => t.id)),
        accountMapping: { Existing: "acct-existing" },
      },
      [existing],
      [],
    );

    expect(rows.map((r) => r.accountName)).toEqual(["Fresh", "Existing"]);
    expect(rows[0].isNew).toBe(true);
  });
});
