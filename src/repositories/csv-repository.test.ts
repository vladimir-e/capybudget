import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Account, Category, Transaction } from "@/lib/types";

// Mock @tauri-apps/api/path
vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

// Mock @tauri-apps/plugin-fs (used by csv service)
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

import { createCsvRepository } from "@/repositories/csv-repository";
import { readTextFile } from "@tauri-apps/plugin-fs";

const mockReadTextFile = vi.mocked(readTextFile);

function makeAccountCsv(accounts: Partial<Account>[]): string {
  const headers = "id,name,type,archived,sortOrder,createdAt";
  const rows = accounts.map((a) => {
    const full: Account = {
      id: "acc-1",
      name: "Cash",
      type: "cash",
      archived: false,
      sortOrder: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...a,
    };
    return `${full.id},${full.name},${full.type},${full.archived},${full.sortOrder},${full.createdAt}`;
  });
  return [headers, ...rows].join("\n");
}

function makeCategoryCsv(categories: Partial<Category>[]): string {
  const headers = "id,name,group,archived,sortOrder";
  const rows = categories.map((c) => {
    const full: Category = {
      id: "cat-1",
      name: "Food",
      group: "Daily Living",
      archived: false,
      sortOrder: 1,
      ...c,
    };
    return `${full.id},${full.name},${full.group},${full.archived},${full.sortOrder}`;
  });
  return [headers, ...rows].join("\n");
}

function makeTransactionCsv(transactions: Partial<Transaction>[]): string {
  const headers =
    "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt";
  const rows = transactions.map((t) => {
    const full: Transaction = {
      id: "txn-1",
      datetime: "2026-01-15T00:00:00.000Z",
      type: "expense",
      amount: -5000,
      categoryId: "cat-1",
      accountId: "acc-1",
      transferPairId: "",
      merchant: "Store",
      note: "",
      createdAt: "2026-01-15T00:00:00.000Z",
      ...t,
    };
    return `${full.id},${full.datetime},${full.type},${full.amount},${full.categoryId},${full.accountId},${full.transferPairId},${full.merchant},${full.note},${full.createdAt}`;
  });
  return [headers, ...rows].join("\n");
}

function stubCsvReads(options?: {
  accounts?: Partial<Account>[];
  categories?: Partial<Category>[];
  transactions?: Partial<Transaction>[];
}) {
  mockReadTextFile.mockImplementation(async (path) => {
    const p = String(path);
    if (p.endsWith("accounts.csv")) {
      return makeAccountCsv(options?.accounts ?? [{ id: "acc-1", name: "Cash" }]);
    }
    if (p.endsWith("categories.csv")) {
      return makeCategoryCsv(
        options?.categories ?? [{ id: "cat-1", name: "Food" }],
      );
    }
    if (p.endsWith("transactions.csv")) {
      return makeTransactionCsv(
        options?.transactions ?? [{ id: "txn-1", amount: -5000 }],
      );
    }
    throw new Error(`Unexpected file path: ${path}`);
  });
}

describe("createCsvRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("file path construction", () => {
    it("constructs correct paths from folder path", async () => {
      stubCsvReads();
      const repo = createCsvRepository("/home/user/budgets/mybudget");
      await repo.getAccounts();
      expect(mockReadTextFile).toHaveBeenCalledWith(
        "/home/user/budgets/mybudget/accounts.csv",
      );
    });

    it("constructs separate paths for each data type", async () => {
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");
      await repo.getAccounts();
      await repo.getCategories();
      await repo.getTransactions();

      const calls = mockReadTextFile.mock.calls.map((c) => c[0]);
      expect(calls).toContain("/budgets/test/accounts.csv");
      expect(calls).toContain("/budgets/test/categories.csv");
      expect(calls).toContain("/budgets/test/transactions.csv");
    });
  });

  describe("lazy loading and caching", () => {
    it("does not read any file until getter is called", () => {
      stubCsvReads();
      createCsvRepository("/budgets/test");
      expect(mockReadTextFile).not.toHaveBeenCalled();
    });

    it("getAccounts reads CSV on first call", async () => {
      stubCsvReads({ accounts: [{ id: "acc-1", name: "Checking" }] });
      const repo = createCsvRepository("/budgets/test");

      const accounts = await repo.getAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].name).toBe("Checking");
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it("getAccounts returns cached data on second call (no re-read)", async () => {
      stubCsvReads({ accounts: [{ id: "acc-1", name: "Checking" }] });
      const repo = createCsvRepository("/budgets/test");

      const first = await repo.getAccounts();
      const second = await repo.getAccounts();

      expect(first).toBe(second); // Same reference — cached
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it("getCategories lazily loads and caches", async () => {
      stubCsvReads({
        categories: [
          { id: "cat-1", name: "Food" },
          { id: "cat-2", name: "Transport" },
        ],
      });
      const repo = createCsvRepository("/budgets/test");

      const cats1 = await repo.getCategories();
      const cats2 = await repo.getCategories();

      expect(cats1).toHaveLength(2);
      expect(cats1).toBe(cats2);
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it("getTransactions lazily loads and caches", async () => {
      stubCsvReads({ transactions: [{ id: "txn-1", amount: -1000 }] });
      const repo = createCsvRepository("/budgets/test");

      const txns1 = await repo.getTransactions();
      const txns2 = await repo.getTransactions();

      expect(txns1).toHaveLength(1);
      expect(txns1).toBe(txns2);
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it("each data type has independent cache", async () => {
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      await repo.getAccounts();
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);

      await repo.getCategories();
      expect(mockReadTextFile).toHaveBeenCalledTimes(2);

      await repo.getTransactions();
      expect(mockReadTextFile).toHaveBeenCalledTimes(3);

      // Second round — all cached, no more reads
      await repo.getAccounts();
      await repo.getCategories();
      await repo.getTransactions();
      expect(mockReadTextFile).toHaveBeenCalledTimes(3);
    });
  });

  describe("CSV coercion", () => {
    it("coerces account archived to boolean and sortOrder to integer", async () => {
      stubCsvReads({
        accounts: [{ id: "acc-1", archived: true, sortOrder: 5 }],
      });
      const repo = createCsvRepository("/budgets/test");
      const accounts = await repo.getAccounts();

      expect(accounts[0].archived).toBe(true);
      expect(typeof accounts[0].archived).toBe("boolean");
      expect(accounts[0].sortOrder).toBe(5);
      expect(typeof accounts[0].sortOrder).toBe("number");
    });

    it("coerces transaction amount to integer", async () => {
      stubCsvReads({ transactions: [{ id: "txn-1", amount: -12345 }] });
      const repo = createCsvRepository("/budgets/test");
      const txns = await repo.getTransactions();

      expect(txns[0].amount).toBe(-12345);
      expect(typeof txns[0].amount).toBe("number");
    });
  });

  describe("saveAccounts / saveCategories / saveTransactions", () => {
    it("saveAccounts updates in-memory cache so next get returns saved data", async () => {
      stubCsvReads({ accounts: [{ id: "acc-1", name: "Old" }] });
      const repo = createCsvRepository("/budgets/test");

      await repo.getAccounts(); // populate cache

      const newAccounts: Account[] = [
        {
          id: "acc-2",
          name: "New",
          type: "savings",
          archived: false,
          sortOrder: 1,
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ];
      await repo.saveAccounts(newAccounts);

      const result = await repo.getAccounts();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("acc-2");
      expect(result[0].name).toBe("New");
      // No additional CSV read — data came from in-memory save
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it("saveCategories updates in-memory cache", async () => {
      stubCsvReads({ categories: [{ id: "cat-1", name: "Old" }] });
      const repo = createCsvRepository("/budgets/test");

      await repo.getCategories();

      const newCategories: Category[] = [
        {
          id: "cat-new",
          name: "Entertainment",
          group: "Personal",
          archived: false,
          sortOrder: 1,
        },
      ];
      await repo.saveCategories(newCategories);

      const result = await repo.getCategories();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Entertainment");
    });

    it("saveTransactions updates in-memory cache", async () => {
      stubCsvReads({ transactions: [{ id: "txn-old" }] });
      const repo = createCsvRepository("/budgets/test");

      await repo.getTransactions();

      const newTxns: Transaction[] = [
        {
          id: "txn-new",
          datetime: "2026-03-01T00:00:00.000Z",
          type: "income",
          amount: 50000,
          categoryId: "",
          accountId: "acc-1",
          transferPairId: "",
          merchant: "Employer",
          note: "",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ];
      await repo.saveTransactions(newTxns);

      const result = await repo.getTransactions();
      expect(result).toHaveLength(1);
      expect(result[0].amount).toBe(50000);
    });
  });

  describe("debounced writes", () => {
    it("save schedules a debounced write, not an immediate one", async () => {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const mockWrite = vi.mocked(writeTextFile);
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      await repo.saveAccounts([
        {
          id: "acc-1",
          name: "Test",
          type: "cash",
          archived: false,
          sortOrder: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]);

      // Write should NOT have happened yet (debounced)
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("debounced write fires after delay", async () => {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const mockWrite = vi.mocked(writeTextFile);
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      await repo.saveAccounts([
        {
          id: "acc-1",
          name: "Test",
          type: "cash",
          archived: false,
          sortOrder: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]);

      await vi.advanceTimersByTimeAsync(300);
      expect(mockWrite).toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("flushes all pending writes immediately", async () => {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const mockWrite = vi.mocked(writeTextFile);
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      // Save all three data types — each schedules a debounced write
      await repo.saveAccounts([
        {
          id: "acc-1",
          name: "A",
          type: "cash",
          archived: false,
          sortOrder: 1,
          createdAt: "",
        },
      ]);
      await repo.saveCategories([
        {
          id: "cat-1",
          name: "C",
          group: "Income",
          archived: false,
          sortOrder: 1,
        },
      ]);
      await repo.saveTransactions([
        {
          id: "txn-1",
          datetime: "",
          type: "expense",
          amount: -100,
          categoryId: "",
          accountId: "",
          transferPairId: "",
          merchant: "",
          note: "",
          createdAt: "",
        },
      ]);

      // Nothing written yet
      expect(mockWrite).not.toHaveBeenCalled();

      // Dispose flushes everything
      await repo.dispose();

      // Each save type should have triggered a writeTextFile (to .tmp)
      // 3 data types = 3 writes
      expect(mockWrite).toHaveBeenCalledTimes(3);
    });

    it("dispose is safe when nothing was saved", async () => {
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      // Dispose with no prior saves should not throw
      await expect(repo.dispose()).resolves.toBeUndefined();
    });

    it("after dispose, advancing timers does not cause duplicate writes", async () => {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      const mockWrite = vi.mocked(writeTextFile);
      stubCsvReads();
      const repo = createCsvRepository("/budgets/test");

      await repo.saveAccounts([
        {
          id: "acc-1",
          name: "A",
          type: "cash",
          archived: false,
          sortOrder: 1,
          createdAt: "",
        },
      ]);

      await repo.dispose();
      const writeCountAfterDispose = mockWrite.mock.calls.length;

      // Advancing timers should NOT cause another write
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockWrite).toHaveBeenCalledTimes(writeCountAfterDispose);
    });
  });

  describe("independent repository instances", () => {
    it("two repositories with different folders have independent caches", async () => {
      stubCsvReads({
        accounts: [{ id: "acc-1", name: "Budget A" }],
      });
      const repoA = createCsvRepository("/budgets/a");
      const repoB = createCsvRepository("/budgets/b");

      const accountsA = await repoA.getAccounts();
      const accountsB = await repoB.getAccounts();

      // Both should have triggered their own read
      expect(mockReadTextFile).toHaveBeenCalledTimes(2);

      // Different references (independent caches)
      expect(accountsA).not.toBe(accountsB);
    });
  });
});
