import { describe, it, expect } from "vitest";
import { prepareMerge } from "./import-merge";
import type { ImportTransaction } from "./import-types";
import type { Account, Transaction } from "./types";

function makeImportTxn(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-03-15",
    description: "GROCERY STORE #123",
    amount: -2500,
    type: "expense",
    sourceAccount: "Chase Checking",
    sourceCategory: "Groceries",
    memo: "",
    merchant: "Grocery Store",
    accountId: "",
    categoryId: "cat-1",
    categoryConfidence: "high",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Existing Account",
    type: "checking",
    archived: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("prepareMerge", () => {
  it("throws if no transactions are selected", () => {
    const txn = makeImportTxn();
    expect(() =>
      prepareMerge(
        { transactions: [txn], selectedIds: new Set(), accountMapping: {} },
        [],
        [],
      ),
    ).toThrow("No transactions selected");
  });

  it("creates accounts for unmapped sources", () => {
    const txn = makeImportTxn({ sourceAccount: "Chase Checking" });
    const result = prepareMerge(
      { transactions: [txn], selectedIds: new Set([txn.id]), accountMapping: {} },
      [],
      [],
    );

    expect(result.sourcesToCreate).toEqual(["Chase Checking"]);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].name).toBe("Chase Checking");
    expect(result.accounts[0].type).toBe("checking");
  });

  it("creates accounts for __create__ mappings", () => {
    const txn = makeImportTxn({ sourceAccount: "Amex Gold" });
    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Amex Gold": "__create__" },
      },
      [],
      [],
    );

    expect(result.sourcesToCreate).toEqual(["Amex Gold"]);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].name).toBe("Amex Gold");
  });

  it("uses mapped account ID when provided", () => {
    const existingAcct = makeAccount({ id: "acct-123", name: "My Chase" });
    const txn = makeImportTxn({ sourceAccount: "Chase Checking" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-123" },
      },
      [existingAcct],
      [],
    );

    expect(result.sourcesToCreate).toEqual([]);
    expect(result.accounts).toEqual([existingAcct]);
    expect(result.transactions[0].accountId).toBe("acct-123");
  });

  it("falls back to import accountId when no mapping exists", () => {
    const txn = makeImportTxn({
      sourceAccount: "",
      accountId: "acct-fallback",
    });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: {},
      },
      [],
      [],
    );

    expect(result.transactions[0].accountId).toBe("acct-fallback");
  });

  it("deduplicates account creation for multiple txns with same source", () => {
    const txn1 = makeImportTxn({ sourceAccount: "Chase Checking" });
    const txn2 = makeImportTxn({ sourceAccount: "Chase Checking" });

    const result = prepareMerge(
      {
        transactions: [txn1, txn2],
        selectedIds: new Set([txn1.id, txn2.id]),
        accountMapping: {},
      },
      [],
      [],
    );

    expect(result.sourcesToCreate).toEqual(["Chase Checking"]);
    expect(result.accounts).toHaveLength(1);
    // Both transactions should reference the same created account
    expect(result.transactions[0].accountId).toBe(result.transactions[1].accountId);
  });

  it("concatenates description and memo into note", () => {
    const txn = makeImportTxn({
      description: "GROCERY STORE #123",
      memo: "Online purchase",
    });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions[0].note).toBe("GROCERY STORE #123 — Online purchase");
  });

  it("uses description only when memo is empty", () => {
    const txn = makeImportTxn({ description: "PAYMENT", memo: "" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions[0].note).toBe("PAYMENT");
  });

  it("uses memo only when description is empty", () => {
    const txn = makeImportTxn({ description: "", memo: "Ref #456" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions[0].note).toBe("Ref #456");
  });

  it("produces empty note when both description and memo are empty", () => {
    const txn = makeImportTxn({ description: "", memo: "" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions[0].note).toBe("");
  });

  it("converts import fields to transaction fields correctly", () => {
    const txn = makeImportTxn({
      date: "2026-03-15",
      type: "expense",
      amount: -2500,
      merchant: "Grocery Store",
      categoryId: "cat-1",
    });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    const out = result.transactions[0];
    expect(out.datetime).toBe("2026-03-15T00:00:00.000");
    expect(out.type).toBe("expense");
    expect(out.amount).toBe(-2500);
    expect(out.merchant).toBe("Grocery Store");
    expect(out.categoryId).toBe("cat-1");
    expect(out.transferPairId).toBe("");
    expect(out.id).toBeTruthy();
    expect(out.createdAt).toBeTruthy();
  });

  it("appends new transactions to existing ones", () => {
    const existingTxn: Transaction = {
      id: "existing-1",
      datetime: "2026-01-01T12:00:00.000",
      type: "expense",
      amount: -1000,
      categoryId: "cat-1",
      accountId: "acct-1",
      transferPairId: "",
      merchant: "Old Store",
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    const txn = makeImportTxn();
    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [existingTxn],
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toBe(existingTxn);
  });

  it("only processes selected transactions", () => {
    const txn1 = makeImportTxn({ description: "Selected" });
    const txn2 = makeImportTxn({ description: "Not selected" });

    const result = prepareMerge(
      {
        transactions: [txn1, txn2],
        selectedIds: new Set([txn1.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].note).toBe("Selected");
  });

  it("updates aliases with created account IDs", () => {
    const txn = makeImportTxn({ sourceAccount: "New Bank" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "New Bank": "__create__" },
      },
      [],
      [],
    );

    const createdId = result.createdAccountIds["New Bank"];
    expect(result.aliases.accounts["New Bank"]).toBe(createdId);
  });

  it("updates aliases with mapped account IDs", () => {
    const txn = makeImportTxn({ sourceAccount: "Chase" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase": "acct-existing" },
      },
      [],
      [],
    );

    expect(result.aliases.accounts["Chase"]).toBe("acct-existing");
  });

  it("preserves existing aliases", () => {
    const txn = makeImportTxn({ sourceAccount: "Chase" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase": "acct-1" },
      },
      [],
      [],
      { accounts: { "Old Bank": "acct-old" } },
    );

    expect(result.aliases.accounts["Old Bank"]).toBe("acct-old");
    expect(result.aliases.accounts["Chase"]).toBe("acct-1");
  });

  it("clears empty categoryId and merchant", () => {
    const txn = makeImportTxn({ categoryId: "", merchant: "" });

    const result = prepareMerge(
      {
        transactions: [txn],
        selectedIds: new Set([txn.id]),
        accountMapping: { "Chase Checking": "acct-1" },
      },
      [],
      [],
    );

    expect(result.transactions[0].categoryId).toBe("");
    expect(result.transactions[0].merchant).toBe("");
  });
});
