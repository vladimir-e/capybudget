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
    targetAccountId: "",
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
    excludeFromNetWorth: false,
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

  describe("transfer pair linking", () => {
    it("links two matching transfers with mutual IDs", () => {
      const txnOut = makeImportTxn({
        type: "transfer",
        amount: -5000,
        sourceAccount: "Chase Checking",
        date: "2026-03-15",
      });
      const txnIn = makeImportTxn({
        type: "transfer",
        amount: 5000,
        sourceAccount: "Savings Account",
        date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txnOut, txnIn],
          selectedIds: new Set([txnOut.id, txnIn.id]),
          accountMapping: { "Chase Checking": "acct-1", "Savings Account": "acct-2" },
        },
        [],
        [],
      );

      const [out, inTxn] = result.transactions;
      expect(out.transferPairId).toBe(inTxn.id);
      expect(inTxn.transferPairId).toBe(out.id);
    });

    it("leaves unmatched transfer with empty transferPairId", () => {
      const txn1 = makeImportTxn({
        type: "transfer",
        amount: -5000,
        sourceAccount: "Chase Checking",
        date: "2026-03-15",
      });
      const txn2 = makeImportTxn({
        type: "transfer",
        amount: 5000,
        sourceAccount: "Savings Account",
        date: "2026-03-15",
      });
      const txn3 = makeImportTxn({
        type: "transfer",
        amount: -3000,
        sourceAccount: "Chase Checking",
        date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txn1, txn2, txn3],
          selectedIds: new Set([txn1.id, txn2.id, txn3.id]),
          accountMapping: { "Chase Checking": "acct-1", "Savings Account": "acct-2" },
        },
        [],
        [],
      );

      const [out1, in1, out2] = result.transactions;
      // First two match
      expect(out1.transferPairId).toBe(in1.id);
      expect(in1.transferPairId).toBe(out1.id);
      // Third has no match
      expect(out2.transferPairId).toBe("");
    });

    it("pairs multiple transfers on same date with different amounts", () => {
      const txnA1 = makeImportTxn({
        type: "transfer", amount: -1000, sourceAccount: "Checking", date: "2026-03-15",
      });
      const txnA2 = makeImportTxn({
        type: "transfer", amount: 1000, sourceAccount: "Savings", date: "2026-03-15",
      });
      const txnB1 = makeImportTxn({
        type: "transfer", amount: -2000, sourceAccount: "Checking", date: "2026-03-15",
      });
      const txnB2 = makeImportTxn({
        type: "transfer", amount: 2000, sourceAccount: "Savings", date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txnA1, txnA2, txnB1, txnB2],
          selectedIds: new Set([txnA1.id, txnA2.id, txnB1.id, txnB2.id]),
          accountMapping: { "Checking": "acct-1", "Savings": "acct-2" },
        },
        [],
        [],
      );

      const [a1, a2, b1, b2] = result.transactions;
      expect(a1.transferPairId).toBe(a2.id);
      expect(a2.transferPairId).toBe(a1.id);
      expect(b1.transferPairId).toBe(b2.id);
      expect(b2.transferPairId).toBe(b1.id);
    });

    it("does not affect non-transfer transactions", () => {
      const expense = makeImportTxn({
        type: "expense", amount: -5000, sourceAccount: "Chase Checking", date: "2026-03-15",
      });
      const income = makeImportTxn({
        type: "income", amount: 5000, sourceAccount: "Savings Account", date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [expense, income],
          selectedIds: new Set([expense.id, income.id]),
          accountMapping: { "Chase Checking": "acct-1", "Savings Account": "acct-2" },
        },
        [],
        [],
      );

      expect(result.transactions[0].transferPairId).toBe("");
      expect(result.transactions[1].transferPairId).toBe("");
    });

    it("does not pair transfers with the same resolved account", () => {
      const txn1 = makeImportTxn({
        type: "transfer", amount: -5000, sourceAccount: "Chase Checking", date: "2026-03-15",
      });
      const txn2 = makeImportTxn({
        type: "transfer", amount: 5000, sourceAccount: "Chase Checking", date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txn1, txn2],
          selectedIds: new Set([txn1.id, txn2.id]),
          accountMapping: { "Chase Checking": "acct-1" },
        },
        [],
        [],
      );

      expect(result.transactions[0].transferPairId).toBe("");
      expect(result.transactions[1].transferPairId).toBe("");
    });

    it("does not pair transfers with empty sourceAccount (no resolved account)", () => {
      const txn1 = makeImportTxn({
        type: "transfer", amount: -5000, sourceAccount: "", accountId: "", date: "2026-03-15",
      });
      const txn2 = makeImportTxn({
        type: "transfer", amount: 5000, sourceAccount: "", accountId: "", date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txn1, txn2],
          selectedIds: new Set([txn1.id, txn2.id]),
          accountMapping: {},
        },
        [],
        [],
      );

      expect(result.transactions[0].transferPairId).toBe("");
      expect(result.transactions[1].transferPairId).toBe("");
    });

    it("does not pair transfers on different dates", () => {
      const txn1 = makeImportTxn({
        type: "transfer", amount: -5000, sourceAccount: "Chase Checking", date: "2026-03-15",
      });
      const txn2 = makeImportTxn({
        type: "transfer", amount: 5000, sourceAccount: "Savings Account", date: "2026-03-16",
      });

      const result = prepareMerge(
        {
          transactions: [txn1, txn2],
          selectedIds: new Set([txn1.id, txn2.id]),
          accountMapping: { "Chase Checking": "acct-1", "Savings Account": "acct-2" },
        },
        [],
        [],
      );

      expect(result.transactions[0].transferPairId).toBe("");
      expect(result.transactions[1].transferPairId).toBe("");
    });
  });

  describe("single-leg transfer with targetAccountId", () => {
    it("creates paired transactions for outflow transfer", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: -5000,
        sourceAccount: "Chase Checking",
        targetAccountId: "acct-savings",
        date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txn],
          selectedIds: new Set([txn.id]),
          accountMapping: { "Chase Checking": "acct-checking" },
        },
        [],
        [],
      );

      // Should create two transactions (the pair)
      expect(result.transactions).toHaveLength(2);

      const from = result.transactions.find((t) => t.amount < 0)!;
      const to = result.transactions.find((t) => t.amount > 0)!;

      expect(from.amount).toBe(-5000);
      expect(from.accountId).toBe("acct-checking");
      expect(from.type).toBe("transfer");

      expect(to.amount).toBe(5000);
      expect(to.accountId).toBe("acct-savings");
      expect(to.type).toBe("transfer");

      // Mutually linked
      expect(from.transferPairId).toBe(to.id);
      expect(to.transferPairId).toBe(from.id);
    });

    it("creates paired transactions for inflow transfer", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: 3000,
        sourceAccount: "Chase Checking",
        targetAccountId: "acct-savings",
        date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [txn],
          selectedIds: new Set([txn.id]),
          accountMapping: { "Chase Checking": "acct-checking" },
        },
        [],
        [],
      );

      expect(result.transactions).toHaveLength(2);

      const inflow = result.transactions.find((t) => t.amount > 0)!;
      const outflow = result.transactions.find((t) => t.amount < 0)!;

      // Inflow arrives at the source account (checking)
      expect(inflow.amount).toBe(3000);
      expect(inflow.accountId).toBe("acct-checking");

      // Outflow leaves the target account (savings)
      expect(outflow.amount).toBe(-3000);
      expect(outflow.accountId).toBe("acct-savings");

      expect(inflow.transferPairId).toBe(outflow.id);
      expect(outflow.transferPairId).toBe(inflow.id);
    });

    it("sets note from description and memo on paired transactions", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: -1000,
        sourceAccount: "Chase Checking",
        targetAccountId: "acct-savings",
        description: "ONLINE TRANSFER",
        memo: "Monthly savings",
      });

      const result = prepareMerge(
        {
          transactions: [txn],
          selectedIds: new Set([txn.id]),
          accountMapping: { "Chase Checking": "acct-checking" },
        },
        [],
        [],
      );

      for (const t of result.transactions) {
        expect(t.note).toBe("ONLINE TRANSFER — Monthly savings");
      }
    });

    it("clears merchant and categoryId on paired transfer transactions", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: -1000,
        sourceAccount: "Chase Checking",
        targetAccountId: "acct-savings",
        merchant: "Should be cleared",
        categoryId: "cat-should-clear",
      });

      const result = prepareMerge(
        {
          transactions: [txn],
          selectedIds: new Set([txn.id]),
          accountMapping: { "Chase Checking": "acct-checking" },
        },
        [],
        [],
      );

      for (const t of result.transactions) {
        expect(t.merchant).toBe("");
        expect(t.categoryId).toBe("");
      }
    });
  });

  describe("unmatched transfer downgrade", () => {
    it("downgrades unmatched outflow transfer to expense", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: -5000,
        sourceAccount: "Chase Checking",
        targetAccountId: "", // no target
        date: "2026-03-15",
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

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe("expense");
      expect(result.transactions[0].amount).toBe(-5000);
      expect(result.transactions[0].transferPairId).toBe("");
    });

    it("downgrades unmatched inflow transfer to income", () => {
      const txn = makeImportTxn({
        type: "transfer",
        amount: 3000,
        sourceAccount: "Chase Checking",
        targetAccountId: "",
        date: "2026-03-15",
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

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe("income");
      expect(result.transactions[0].amount).toBe(3000);
    });
  });

  describe("linkTransferPairs skips already-paired", () => {
    it("does not re-pair pre-paired single-leg transfers during YNAB-style linking", () => {
      // One single-leg transfer (pre-paired) + one YNAB-style two-leg pair
      const singleLeg = makeImportTxn({
        type: "transfer",
        amount: -5000,
        sourceAccount: "Chase Checking",
        targetAccountId: "acct-savings", // will be pre-paired
        date: "2026-03-15",
      });
      const ynabOut = makeImportTxn({
        type: "transfer",
        amount: -2000,
        sourceAccount: "Chase Checking",
        date: "2026-03-15",
      });
      const ynabIn = makeImportTxn({
        type: "transfer",
        amount: 2000,
        sourceAccount: "Savings Account",
        date: "2026-03-15",
      });

      const result = prepareMerge(
        {
          transactions: [singleLeg, ynabOut, ynabIn],
          selectedIds: new Set([singleLeg.id, ynabOut.id, ynabIn.id]),
          accountMapping: { "Chase Checking": "acct-checking", "Savings Account": "acct-savings" },
        },
        [],
        [],
      );

      // 2 from single-leg pair + 2 from YNAB pair = 4
      expect(result.transactions).toHaveLength(4);

      // All should be paired
      for (const t of result.transactions) {
        expect(t.type).toBe("transfer");
        expect(t.transferPairId).toBeTruthy();
      }

      // The single-leg pair IDs should reference each other
      const singlePair = result.transactions.filter(
        (t) => Math.abs(t.amount) === 5000,
      );
      expect(singlePair).toHaveLength(2);
      expect(singlePair[0].transferPairId).toBe(singlePair[1].id);
      expect(singlePair[1].transferPairId).toBe(singlePair[0].id);

      // The YNAB pair IDs should reference each other
      const ynabPair = result.transactions.filter(
        (t) => Math.abs(t.amount) === 2000,
      );
      expect(ynabPair).toHaveLength(2);
      expect(ynabPair[0].transferPairId).toBe(ynabPair[1].id);
      expect(ynabPair[1].transferPairId).toBe(ynabPair[0].id);
    });
  });
});
