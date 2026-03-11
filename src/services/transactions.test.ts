import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/types";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionFormData,
} from "@/services/transactions";

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    datetime: "2026-01-15T12:00:00.000Z",
    type: "expense",
    amount: -5000,
    categoryId: "cat-1",
    accountId: "acc-1",
    transferPairId: "",
    merchant: "Store",
    note: "",
    createdAt: "2026-01-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("createTransaction", () => {
  it("creates an income transaction with positive amount", () => {
    const input: TransactionFormData = {
      type: "income",
      amount: 10000,
      categoryId: "cat-income",
      accountId: "acc-checking",
      date: "2026-03-01",
      merchant: "Employer",
      note: "salary",
    };

    const result = createTransaction(input, []);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.type).toBe("income");
    expect(txn.amount).toBe(10000);
    expect(txn.categoryId).toBe("cat-income");
    expect(txn.accountId).toBe("acc-checking");
    expect(txn.merchant).toBe("Employer");
    expect(txn.note).toBe("salary");
    expect(txn.transferPairId).toBe("");
    expect(txn.datetime).toMatch(/^2026-03-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(txn.id).toBeTruthy();
    expect(txn.createdAt).toBeTruthy();
  });

  it("creates an expense transaction with negative amount", () => {
    const input: TransactionFormData = {
      type: "expense",
      amount: 3500,
      categoryId: "cat-food",
      accountId: "acc-cash",
      date: "2026-03-02",
      merchant: "Grocery",
      note: "",
    };

    const result = createTransaction(input, []);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.type).toBe("expense");
    expect(txn.amount).toBe(-3500);
    expect(txn.merchant).toBe("Grocery");
    expect(txn.transferPairId).toBe("");
  });

  it("appends to existing transactions", () => {
    const existing = [makeTxn()];
    const input: TransactionFormData = {
      type: "income",
      amount: 1000,
      categoryId: "cat-1",
      accountId: "acc-1",
      date: "2026-03-01",
      merchant: "Test",
      note: "",
    };

    const result = createTransaction(input, existing);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing[0]);
  });

  describe("transfer", () => {
    const transferInput: TransactionFormData = {
      type: "transfer",
      amount: 25000,
      categoryId: "",
      accountId: "acc-checking",
      toAccountId: "acc-savings",
      date: "2026-03-05",
      merchant: "",
      note: "monthly savings",
    };

    it("creates two linked transactions", () => {
      const result = createTransaction(transferInput, []);
      expect(result).toHaveLength(2);
    });

    it("from leg has negative amount and source account", () => {
      const result = createTransaction(transferInput, []);
      const from = result[0];
      expect(from.amount).toBe(-25000);
      expect(from.accountId).toBe("acc-checking");
      expect(from.type).toBe("transfer");
    });

    it("to leg has positive amount and destination account", () => {
      const result = createTransaction(transferInput, []);
      const to = result[1];
      expect(to.amount).toBe(25000);
      expect(to.accountId).toBe("acc-savings");
      expect(to.type).toBe("transfer");
    });

    it("legs have mutual transferPairIds", () => {
      const result = createTransaction(transferInput, []);
      const from = result[0];
      const to = result[1];
      expect(from.transferPairId).toBe(to.id);
      expect(to.transferPairId).toBe(from.id);
    });

    it("both legs have empty categoryId and merchant", () => {
      const result = createTransaction(transferInput, []);
      for (const leg of result) {
        expect(leg.categoryId).toBe("");
        expect(leg.merchant).toBe("");
      }
    });

    it("both legs share the note", () => {
      const result = createTransaction(transferInput, []);
      for (const leg of result) {
        expect(leg.note).toBe("monthly savings");
      }
    });
  });
});

describe("updateTransaction", () => {
  it("updates income transaction fields", () => {
    const existing = [
      makeTxn({ id: "inc-1", type: "income", amount: 10000, categoryId: "cat-salary", merchant: "Old Corp" }),
    ];
    const input: TransactionFormData = {
      id: "inc-1",
      type: "income",
      amount: 12000,
      categoryId: "cat-bonus",
      accountId: "acc-2",
      date: "2026-04-01",
      merchant: "New Corp",
      note: "raise",
    };

    const result = updateTransaction(input, existing);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.id).toBe("inc-1");
    expect(txn.amount).toBe(12000);
    expect(txn.categoryId).toBe("cat-bonus");
    expect(txn.accountId).toBe("acc-2");
    expect(txn.merchant).toBe("New Corp");
    expect(txn.note).toBe("raise");
    expect(txn.datetime).toMatch(/^2026-04-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("updates expense transaction with negative amount", () => {
    const existing = [
      makeTxn({ id: "exp-1", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "exp-1",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-04-02",
      merchant: "New Store",
      note: "",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].amount).toBe(-7500);
    expect(result[0].type).toBe("expense");
  });

  it("does not modify other transactions", () => {
    const other = makeTxn({ id: "other" });
    const target = makeTxn({ id: "target", type: "income", amount: 1000 });
    const input: TransactionFormData = {
      id: "target",
      type: "income",
      amount: 2000,
      categoryId: "cat-1",
      accountId: "acc-1",
      date: "2026-04-01",
      merchant: "M",
      note: "",
    };

    const result = updateTransaction(input, [other, target]);
    expect(result[0]).toBe(other);
    expect(result[1].amount).toBe(2000);
  });

  it("preserves original time when date is unchanged", () => {
    const existing = [
      makeTxn({ id: "txn-keep-time", datetime: "2026-01-15T21:30:45.123", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "txn-keep-time",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-01-15", // same date as original
      merchant: "Updated Store",
      note: "updated",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].datetime).toBe("2026-01-15T21:30:45.123");
  });

  it("generates new time when date changes", () => {
    const existing = [
      makeTxn({ id: "txn-new-time", datetime: "2026-01-15T21:30:45.123", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "txn-new-time",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-01-20", // different date
      merchant: "Updated Store",
      note: "updated",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].datetime).toMatch(/^2026-01-20T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(result[0].datetime).not.toBe("2026-01-15T21:30:45.123");
  });

  describe("transfer update", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      accountId: "acc-checking",
      transferPairId: "tf-to",
      merchant: "",
      categoryId: "",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      accountId: "acc-savings",
      transferPairId: "tf-from",
      merchant: "",
      categoryId: "",
    });

    it("updates both legs of a transfer", () => {
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 30000,
        categoryId: "",
        accountId: "acc-new-from",
        toAccountId: "acc-new-to",
        date: "2026-05-01",
        merchant: "",
        note: "updated note",
      };

      const result = updateTransaction(input, [fromLeg, toLeg]);
      expect(result).toHaveLength(2);

      const updatedFrom = result.find((t) => t.id === "tf-from")!;
      const updatedTo = result.find((t) => t.id === "tf-to")!;

      expect(updatedFrom.amount).toBe(-30000);
      expect(updatedFrom.accountId).toBe("acc-new-from");
      expect(updatedFrom.note).toBe("updated note");
      expect(updatedFrom.datetime).toMatch(/^2026-05-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);

      expect(updatedTo.amount).toBe(30000);
      expect(updatedTo.accountId).toBe("acc-new-to");
      expect(updatedTo.note).toBe("updated note");
      expect(updatedTo.datetime).toMatch(/^2026-05-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("preserves original time on both legs when date is unchanged", () => {
      const fromLegSameDate = makeTxn({
        id: "tf-from",
        type: "transfer",
        amount: -25000,
        accountId: "acc-checking",
        transferPairId: "tf-to",
        merchant: "",
        categoryId: "",
        datetime: "2026-01-15T21:30:45.123",
      });
      const toLegSameDate = makeTxn({
        id: "tf-to",
        type: "transfer",
        amount: 25000,
        accountId: "acc-savings",
        transferPairId: "tf-from",
        merchant: "",
        categoryId: "",
        datetime: "2026-01-15T21:30:45.123",
      });
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 30000,
        categoryId: "",
        accountId: "acc-checking",
        toAccountId: "acc-savings",
        date: "2026-01-15", // same date
        merchant: "",
        note: "updated",
      };

      const result = updateTransaction(input, [fromLegSameDate, toLegSameDate]);
      expect(result.find((t) => t.id === "tf-from")!.datetime).toBe("2026-01-15T21:30:45.123");
      expect(result.find((t) => t.id === "tf-to")!.datetime).toBe("2026-01-15T21:30:45.123");
    });

    it("clears merchant on both transfer legs", () => {
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 25000,
        categoryId: "",
        accountId: "acc-checking",
        toAccountId: "acc-savings",
        date: "2026-05-01",
        merchant: "should be ignored",
        note: "",
      };

      const result = updateTransaction(input, [fromLeg, toLeg]);
      expect(result[0].merchant).toBe("");
      expect(result[1].merchant).toBe("");
    });
  });
});

describe("deleteTransaction", () => {
  it("removes a single income transaction", () => {
    const income = makeTxn({ id: "inc-1", type: "income", amount: 10000 });
    const other = makeTxn({ id: "other" });
    const result = deleteTransaction(income, [income, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });

  it("removes a single expense transaction", () => {
    const expense = makeTxn({ id: "exp-1", type: "expense", amount: -5000 });
    const result = deleteTransaction(expense, [expense]);
    expect(result).toHaveLength(0);
  });

  it("removes both legs of a transfer", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      transferPairId: "tf-to",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      transferPairId: "tf-from",
    });
    const other = makeTxn({ id: "other" });

    const result = deleteTransaction(fromLeg, [fromLeg, toLeg, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });

  it("removes both legs when deleting the to-leg of a transfer", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      transferPairId: "tf-to",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      transferPairId: "tf-from",
    });

    const result = deleteTransaction(toLeg, [fromLeg, toLeg]);
    expect(result).toHaveLength(0);
  });

  it("only removes the target when transfer has no transferPairId", () => {
    const orphanTransfer = makeTxn({
      id: "tf-orphan",
      type: "transfer",
      amount: -5000,
      transferPairId: "",
    });
    const other = makeTxn({ id: "other" });

    const result = deleteTransaction(orphanTransfer, [orphanTransfer, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });
});
