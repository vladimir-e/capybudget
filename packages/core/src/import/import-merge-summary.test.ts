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

describe("summarizeMerge — per-source-account rows", () => {
  it("summarizes a single source into an existing account", () => {
    const acct = makeAccount({ id: "acct-1", name: "My Chase", type: "checking" });
    const existing = makeTransaction({ accountId: "acct-1", amount: 10000 });
    const txn = makeImportTxn({ sourceAccount: "Chase Checking", amount: -2500 });

    const { rows, unmappedTransferCount } = summarizeMerge(
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
      sourceAccount: "Chase Checking",
      accountId: "acct-1",
      accountName: "My Chase",
      accountType: "checking",
      isNew: false,
      count: 1,
      resultingBalance: 7500,
    });
    expect(unmappedTransferCount).toBe(0);
  });

  it("reports a newly created account from a zero balance", () => {
    const txn = makeImportTxn({ sourceAccount: "New Bank", amount: -3000 });

    const { rows } = summarizeMerge(
      { transactions: [txn], selectedIds: new Set([txn.id]), accountMapping: {} },
      [],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceAccount: "New Bank",
      accountName: "New Bank",
      isNew: true,
      count: 1,
      resultingBalance: -3000,
    });
  });

  it("merges two sources mapped to one account into two rows", () => {
    const acct = makeAccount({ id: "acct-1", name: "Wallet", type: "cash" });
    const a = makeImportTxn({ sourceAccount: "Cash A", amount: -1000 });
    const b = makeImportTxn({ sourceAccount: "Cash B", amount: 4000, type: "income" });

    const { rows } = summarizeMerge(
      {
        transactions: [a, b],
        selectedIds: new Set([a.id, b.id]),
        accountMapping: { "Cash A": "acct-1", "Cash B": "acct-1" },
      },
      [acct],
      [],
    );

    // One row per source account, both pointing at the same destination — its
    // resulting balance is the combined post-merge total.
    expect(rows).toHaveLength(2);
    const bySource = Object.fromEntries(rows.map((r) => [r.sourceAccount, r]));
    expect(bySource["Cash A"]).toMatchObject({
      accountId: "acct-1",
      count: 1,
      resultingBalance: 3000,
    });
    expect(bySource["Cash B"]).toMatchObject({
      accountId: "acct-1",
      count: 1,
      resultingBalance: 3000,
    });
  });

  it("resultingBalance includes a transfer leg landing on a row's destination", () => {
    const checking = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const savings = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // $500 leaves Checking (a source), lands in Savings (only a transfer target).
    const transfer = makeImportTxn({
      sourceAccount: "Checking",
      type: "transfer",
      amount: -50000,
      targetAccountId: "acct-sav",
      categoryId: "",
    });

    const { rows, unmappedTransferCount } = summarizeMerge(
      {
        transactions: [transfer],
        selectedIds: new Set([transfer.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [checking, savings],
      [],
    );

    // Savings is a transfer counterpart, not an import source → no row for it.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceAccount: "Checking",
      accountId: "acct-chk",
      count: 1,
      resultingBalance: -50000,
    });
    expect(rows.some((r) => r.accountId === "acct-sav")).toBe(false);
    // A matched single-leg transfer is mapped.
    expect(unmappedTransferCount).toBe(0);
  });

  it("balance math holds across mixed inflow/outflow on one source", () => {
    const acct = makeAccount({ id: "acct-1", name: "Card", type: "credit_card" });
    const existing = [
      makeTransaction({ accountId: "acct-1", amount: -5000 }),
      makeTransaction({ accountId: "acct-1", amount: -1500 }),
    ];
    const txns = [
      makeImportTxn({ sourceAccount: "Card", amount: -2000 }),
      makeImportTxn({ sourceAccount: "Card", amount: 3000, type: "income" }),
    ];

    const { rows } = summarizeMerge(
      {
        transactions: txns,
        selectedIds: new Set(txns.map((t) => t.id)),
        accountMapping: { Card: "acct-1" },
      },
      [acct],
      existing,
    );

    // -6500 current + (-2000 + 3000) = -5500.
    expect(rows).toHaveLength(1);
    expect(rows[0].resultingBalance).toBe(-5500);
  });

  it("only counts selected transactions", () => {
    const acct = makeAccount({ id: "acct-1", name: "Bank", type: "checking" });
    const selected = makeImportTxn({ sourceAccount: "Bank", amount: -1000 });
    const skipped = makeImportTxn({ sourceAccount: "Bank", amount: -9999 });

    const { rows } = summarizeMerge(
      {
        transactions: [selected, skipped],
        selectedIds: new Set([selected.id]),
        accountMapping: { Bank: "acct-1" },
      },
      [acct],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1, resultingBalance: -1000 });
  });

  it("sorts new accounts first, then by count descending", () => {
    const existing = makeAccount({ id: "acct-existing", name: "Existing", type: "checking" });
    const txns = [
      makeImportTxn({ sourceAccount: "Existing", amount: -100 }),
      makeImportTxn({ sourceAccount: "Existing", amount: -200 }),
      makeImportTxn({ sourceAccount: "Fresh", amount: -300 }),
    ];

    const { rows } = summarizeMerge(
      {
        transactions: txns,
        selectedIds: new Set(txns.map((t) => t.id)),
        accountMapping: { Existing: "acct-existing" },
      },
      [existing],
      [],
    );

    expect(rows.map((r) => r.sourceAccount)).toEqual(["Fresh", "Existing"]);
    expect(rows[0].isNew).toBe(true);
  });
});

describe("summarizeMerge — unmappedTransferCount", () => {
  it("counts zero for a paired two-leg transfer", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // YNAB-style: two transfer rows, opposite amounts, same date, paired on merge.
    const out = makeImportTxn({ sourceAccount: "Checking", type: "transfer", amount: -20000, categoryId: "" });
    const inn = makeImportTxn({ sourceAccount: "Savings", type: "transfer", amount: 20000, categoryId: "" });

    const { rows, unmappedTransferCount } = summarizeMerge(
      {
        transactions: [out, inn],
        selectedIds: new Set([out.id, inn.id]),
        accountMapping: { Checking: "acct-chk", Savings: "acct-sav" },
      },
      [chk, sav],
      [],
    );

    expect(unmappedTransferCount).toBe(0);
    // Both sources get a row; neither destination is a bare transfer counterpart.
    expect(rows.map((r) => r.sourceAccount).sort()).toEqual(["Checking", "Savings"]);
  });

  it("counts zero for a single-leg transfer with a known target", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    const transfer = makeImportTxn({
      sourceAccount: "Checking",
      type: "transfer",
      amount: -50000,
      targetAccountId: "acct-sav",
      categoryId: "",
    });

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [transfer],
        selectedIds: new Set([transfer.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [chk, sav],
      [],
    );

    expect(unmappedTransferCount).toBe(0);
  });

  it("counts one for an unpaired transfer with no target", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    // A lone transfer, no targetAccountId and no opposite leg to pair with →
    // prepareMerge downgrades it to an expense.
    const transfer = makeImportTxn({
      sourceAccount: "Checking",
      type: "transfer",
      amount: -50000,
      categoryId: "",
    });

    const { rows, unmappedTransferCount } = summarizeMerge(
      {
        transactions: [transfer],
        selectedIds: new Set([transfer.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [chk],
      [],
    );

    expect(unmappedTransferCount).toBe(1);
    // The downgraded row still feeds its source account's balance.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourceAccount: "Checking", resultingBalance: -50000 });
  });

  it("mixes a matched and an unmapped transfer in one merge", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    const matched = makeImportTxn({
      id: "t-matched",
      sourceAccount: "Checking",
      type: "transfer",
      amount: -10000,
      targetAccountId: "acct-sav",
      categoryId: "",
    });
    const orphan = makeImportTxn({
      id: "t-orphan",
      sourceAccount: "Checking",
      type: "transfer",
      amount: -2000,
      categoryId: "",
    });

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [matched, orphan],
        selectedIds: new Set([matched.id, orphan.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [chk, sav],
      [],
    );

    expect(unmappedTransferCount).toBe(1);
  });
});
