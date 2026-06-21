import { describe, it, expect } from "vitest";
import { makeAccount } from "@capybudget/core/test-factories";
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

describe("summarizeMerge — unmappedTransferCount", () => {
  it("counts zero when nothing is selected", () => {
    const txn = makeImportTxn();
    expect(
      summarizeMerge(
        { transactions: [txn], selectedIds: new Set(), accountMapping: {} },
        [],
        [],
        "USD",
      ),
    ).toEqual({ unmappedTransferCount: 0 });
  });

  it("counts zero for non-transfer rows", () => {
    const acct = makeAccount({ id: "acct-1", name: "Bank", type: "checking" });
    const txn = makeImportTxn({ sourceAccount: "Bank", amount: -1000 });

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { Bank: "acct-1" },
      },
      [acct],
      [],
      "USD",
    );

    expect(unmappedTransferCount).toBe(0);
  });

  it("counts zero for a paired two-leg transfer", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // YNAB-style: two transfer rows, opposite amounts, same date, paired on merge.
    const out = makeImportTxn({ sourceAccount: "Checking", type: "transfer", amount: -20000, categoryId: "" });
    const inn = makeImportTxn({ sourceAccount: "Savings", type: "transfer", amount: 20000, categoryId: "" });

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [out, inn],
        selectedIds: new Set([out.id, inn.id]),
        accountMapping: { Checking: "acct-chk", Savings: "acct-sav" },
      },
      [chk, sav],
      [],
      "USD",
    );

    expect(unmappedTransferCount).toBe(0);
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
      "USD",
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

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [transfer],
        selectedIds: new Set([transfer.id]),
        accountMapping: { Checking: "acct-chk" },
      },
      [chk],
      [],
      "USD",
    );

    expect(unmappedTransferCount).toBe(1);
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
      "USD",
    );

    expect(unmappedTransferCount).toBe(1);
  });

  it("counts the orphan when its amount collides with a targeted transfer's leg", () => {
    const chk = makeAccount({ id: "acct-chk", name: "Checking", type: "checking" });
    const sav = makeAccount({ id: "acct-sav", name: "Savings", type: "savings" });
    // A single-leg transfer Checking → Savings creates a +10000 pre-paired leg on
    // Savings. The orphan is a +10000 transfer on Savings, same date — the exact
    // amount/date/account of that leg. It must NOT steal the pre-paired leg's
    // partner; it stays unpaired and downgrades. Locks the count to the plan so a
    // future linkTransferPairs change can't silently re-pair the collision.
    const targeted = makeImportTxn({
      id: "t-targeted",
      sourceAccount: "Checking",
      type: "transfer",
      amount: -10000,
      targetAccountId: "acct-sav",
      categoryId: "",
    });
    const orphan = makeImportTxn({
      id: "t-orphan",
      sourceAccount: "Savings",
      type: "transfer",
      amount: 10000,
      categoryId: "",
    });

    const { unmappedTransferCount } = summarizeMerge(
      {
        transactions: [targeted, orphan],
        selectedIds: new Set([targeted.id, orphan.id]),
        accountMapping: { Checking: "acct-chk", Savings: "acct-sav" },
      },
      [chk, sav],
      [],
      "USD",
    );

    expect(unmappedTransferCount).toBe(1);
  });
});
