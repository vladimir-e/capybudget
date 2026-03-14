import { describe, it, expect } from "vitest";
import {
  createAccount,
  createOpeningBalanceTransaction,
  updateAccount,
  deleteAccount,
  archiveAccount,
  unarchiveAccount,
} from "./accounts";
import type { Account, Transaction } from "./types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Test Account",
    type: "checking",
    archived: false,
    sortOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTxn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
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

describe("createAccount", () => {
  it("assigns a UUID and createdAt", () => {
    const account = createAccount({ name: "Cash", type: "cash" }, []);
    expect(account.id).toBeTruthy();
    expect(account.createdAt).toBeTruthy();
    expect(account.archived).toBe(false);
  });

  it("sets sortOrder to 1 when no accounts of that type exist", () => {
    const account = createAccount({ name: "Cash", type: "cash" }, []);
    expect(account.sortOrder).toBe(1);
  });

  it("sets sortOrder to max + 1 for the same type", () => {
    const existing = [
      makeAccount({ type: "checking", sortOrder: 3 }),
      makeAccount({ type: "checking", sortOrder: 7 }),
      makeAccount({ type: "savings", sortOrder: 10 }),
    ];
    const account = createAccount(
      { name: "New Checking", type: "checking" },
      existing,
    );
    expect(account.sortOrder).toBe(8);
  });

  it("ignores sortOrder of other account types", () => {
    const existing = [makeAccount({ type: "savings", sortOrder: 99 })];
    const account = createAccount(
      { name: "Cash", type: "cash" },
      existing,
    );
    expect(account.sortOrder).toBe(1);
  });
});

describe("createOpeningBalanceTransaction", () => {
  it("creates an income transaction when amount > 0", () => {
    const account = makeAccount({ id: "acc-new" });
    const result = createOpeningBalanceTransaction(account, 10000, []);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("income");
    expect(result[0].amount).toBe(10000);
    expect(result[0].accountId).toBe("acc-new");
    expect(result[0].merchant).toBe("Opening Balance");
    expect(result[0].datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("returns existing list unchanged when amount is 0", () => {
    const account = makeAccount();
    const existing = [makeTxn()];
    const result = createOpeningBalanceTransaction(account, 0, existing);
    expect(result).toBe(existing);
  });

  it("appends to existing transactions", () => {
    const account = makeAccount({ id: "acc-new" });
    const existing = [makeTxn(), makeTxn()];
    const result = createOpeningBalanceTransaction(account, 500, existing);
    expect(result).toHaveLength(3);
    expect(result[2].merchant).toBe("Opening Balance");
  });
});

describe("updateAccount", () => {
  it("updates name and type of the target account", () => {
    const acc = makeAccount({ id: "acc-1", name: "Old", type: "checking" });
    const result = updateAccount(
      { id: "acc-1", name: "New", type: "savings" },
      [acc],
    );
    expect(result[0].name).toBe("New");
    expect(result[0].type).toBe("savings");
  });

  it("leaves other fields unchanged", () => {
    const acc = makeAccount({
      id: "acc-1",
      sortOrder: 5,
      archived: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const result = updateAccount(
      { id: "acc-1", name: "Updated", type: "cash" },
      [acc],
    );
    expect(result[0].sortOrder).toBe(5);
    expect(result[0].archived).toBe(true);
    expect(result[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does not modify other accounts", () => {
    const target = makeAccount({ id: "acc-1", name: "Target" });
    const other = makeAccount({ id: "acc-2", name: "Other" });
    const result = updateAccount(
      { id: "acc-1", name: "Changed", type: "cash" },
      [target, other],
    );
    expect(result[1].name).toBe("Other");
  });
});

describe("deleteAccount", () => {
  it("removes the account when it has no transactions", () => {
    const acc = makeAccount({ id: "acc-1" });
    const result = deleteAccount("acc-1", [acc], []);
    expect(result.accounts).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
  });

  it("removes the account and its opening balance transaction", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [makeTxn({
      accountId: "acc-1",
      type: "income",
      merchant: "Opening Balance",
      categoryId: "",
      transferPairId: "",
    })];
    const result = deleteAccount("acc-1", [acc], txns);
    expect(result.accounts).toHaveLength(0);
    expect(result.transactions).toHaveLength(0);
  });

  it("throws when account has a non-opening-balance transaction", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [makeTxn({ accountId: "acc-1", merchant: "Grocery Store" })];
    expect(() => deleteAccount("acc-1", [acc], txns)).toThrow(
      /Cannot delete account/,
    );
  });

  it("does not remove other accounts or their transactions", () => {
    const acc1 = makeAccount({ id: "acc-1" });
    const acc2 = makeAccount({ id: "acc-2" });
    const otherTxn = makeTxn({ accountId: "acc-2" });
    const result = deleteAccount("acc-1", [acc1, acc2], [otherTxn]);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].id).toBe("acc-2");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].accountId).toBe("acc-2");
  });
});

describe("archiveAccount", () => {
  it("archives when balance is zero (no transactions)", () => {
    const acc = makeAccount({ id: "acc-1", archived: false });
    const result = archiveAccount("acc-1", [acc], []);
    expect(result[0].archived).toBe(true);
  });

  it("archives when transactions sum to zero", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [
      makeTxn({ accountId: "acc-1", amount: 5000 }),
      makeTxn({ accountId: "acc-1", amount: -5000 }),
    ];
    const result = archiveAccount("acc-1", [acc], txns);
    expect(result[0].archived).toBe(true);
  });

  it("throws when balance is positive", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [makeTxn({ accountId: "acc-1", amount: 1000 })];
    expect(() => archiveAccount("acc-1", [acc], txns)).toThrow(
      /non-zero balance/,
    );
  });

  it("throws when balance is negative", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [makeTxn({ accountId: "acc-1", amount: -500 })];
    expect(() => archiveAccount("acc-1", [acc], txns)).toThrow(
      /non-zero balance/,
    );
  });

  it("only considers transactions for the target account", () => {
    const acc = makeAccount({ id: "acc-1" });
    const txns = [
      makeTxn({ accountId: "acc-2", amount: 99999 }),
    ];
    const result = archiveAccount("acc-1", [acc], txns);
    expect(result[0].archived).toBe(true);
  });
});

describe("unarchiveAccount", () => {
  it("sets archived to false", () => {
    const acc = makeAccount({ id: "acc-1", archived: true });
    const result = unarchiveAccount("acc-1", [acc]);
    expect(result[0].archived).toBe(false);
  });

  it("does not modify other accounts", () => {
    const acc1 = makeAccount({ id: "acc-1", archived: true });
    const acc2 = makeAccount({ id: "acc-2", archived: true });
    const result = unarchiveAccount("acc-1", [acc1, acc2]);
    expect(result[0].archived).toBe(false);
    expect(result[1].archived).toBe(true);
  });
});
