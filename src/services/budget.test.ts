import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectBudget, bootstrapBudget, inspectFolder, findMissingBudgetPaths } from "./budget";
import { DEFAULT_CATEGORIES } from "@capybudget/core";

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

const mockExists = vi.fn();
const mockReadTextFile = vi.fn();
const mockWriteTextFile = vi.fn().mockResolvedValue(undefined);
const mockReadDir = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  readDir: (...args: unknown[]) => mockReadDir(...args),
}));

describe("detectBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when budget.json does not exist", async () => {
    mockExists.mockResolvedValue(false);
    const result = await detectBudget("/path/to/folder");
    expect(result).toBeNull();
    expect(mockExists).toHaveBeenCalledWith("/path/to/folder/budget.json");
  });

  it("returns parsed BudgetMeta when budget.json exists at current version", async () => {
    const meta = {
      schemaVersion: 4,
      name: "Test Budget",
      currency: "USD",
      currencyDecimals: 2,
      currencySymbolPosition: "before",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(meta));

    const result = await detectBudget("/budgets/test");
    expect(result).toEqual(meta);
    expect(mockReadTextFile).toHaveBeenCalledWith("/budgets/test/budget.json");
  });

  it("backfills format fields from the currency for a pre-format budget.json", async () => {
    // A budget.json written before the format fields shipped is at the current
    // schema version but lacks decimals + symbol position. detectBudget backfills
    // them from the currency's defaults (RUB → 0 decimals, symbol after).
    const preFormat = {
      schemaVersion: 4,
      name: "Pre-format",
      currency: "RUB",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(preFormat));

    const result = await detectBudget("/budgets/preformat");
    expect(result?.currencyDecimals).toBe(0);
    expect(result?.currencySymbolPosition).toBe("after");
  });

  it("defaults currency to USD for a current-version, pre-currency budget.json", async () => {
    // A budget.json written before the currency field shipped is at the
    // current schema version but lacks `currency`. detectBudget must return a
    // type-complete BudgetMeta rather than `currency: undefined`.
    const preCurrency = {
      schemaVersion: 4,
      name: "Legacy Budget",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(preCurrency));

    const result = await detectBudget("/budgets/legacy");
    expect(result?.currency).toBe("USD");
  });

  it("defaults currency to USD when migrating a pre-currency budget", async () => {
    // A v1 budget predates the currency field entirely. After migration the
    // returned meta is at the current version, whose shape requires `currency`.
    const oldMeta = {
      schemaVersion: 1,
      name: "Old Budget",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    const oldAccountsCsv = "id,name,type,archived,sortOrder,createdAt";
    const oldCategoriesCsv = "id,name,group,archived,sortOrder";
    const oldTransactionsCsv =
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt";

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(oldMeta);
      if (path.endsWith("accounts.csv")) return oldAccountsCsv;
      if (path.endsWith("categories.csv")) return oldCategoriesCsv;
      if (path.endsWith("transactions.csv")) return oldTransactionsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    const result = await detectBudget("/budgets/old");
    expect(result?.schemaVersion).toBe(4);
    expect(result?.currency).toBe("USD");

    const metaWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("budget.json"),
    );
    expect(JSON.parse(metaWrite![1]).currency).toBe("USD");
  });

  it("runs pending migrations and writes updated budget.json", async () => {
    // budget.json is at v1; the CSVs lack every column added since. detectBudget
    // walks v1 → v2 → v3 → v4 sequentially. This asserts the v1 → v2 (accounts)
    // and v2 → v3 (categories) steps; the v3 → v4 step is covered on its own.
    const oldMeta = {
      schemaVersion: 1,
      name: "Old Budget",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    const oldAccountsCsv = [
      "id,name,type,archived,sortOrder,createdAt",
      "acc-1,Cash,cash,false,1,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const oldCategoriesCsv = [
      "id,name,group,archived,sortOrder",
      "cat-1,Food,Daily Living,false,1",
    ].join("\n");
    const oldTransactionsCsv =
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt";

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(oldMeta);
      if (path.endsWith("accounts.csv")) return oldAccountsCsv;
      if (path.endsWith("categories.csv")) return oldCategoriesCsv;
      if (path.endsWith("transactions.csv")) return oldTransactionsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    const result = await detectBudget("/budgets/test");

    expect(result?.schemaVersion).toBe(4);

    // v1 → v2 rewrote accounts.csv with the new column (first accounts write).
    const accountsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("accounts.csv"),
    );
    expect(accountsWrite).toBeDefined();
    expect(accountsWrite![1]).toContain("excludeFromNetWorth");
    expect(accountsWrite![1]).toContain("acc-1,Cash,cash,false,false,1");

    // v2 → v3 rewrote categories.csv with an empty `assigned` column.
    const categoriesWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("categories.csv"),
    );
    expect(categoriesWrite).toBeDefined();
    expect(categoriesWrite![1]).toContain("assigned");
    // Empty cell = untracked. Trailing comma after sortOrder is what we want.
    expect(categoriesWrite![1]).toContain("cat-1,Food,Daily Living,false,1,");

    // budget.json was rewritten with the new schemaVersion.
    const metaWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("budget.json"),
    );
    expect(metaWrite).toBeDefined();
    expect(JSON.parse(metaWrite![1]).schemaVersion).toBe(4);
  });

  it("runs only the v2 → v3 and v3 → v4 migrations when starting from v2", async () => {
    const oldMeta = {
      schemaVersion: 2,
      name: "v2 Budget",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    // Already at v2: accounts.csv carries excludeFromNetWorth, so v1 → v2 is
    // skipped, but v3 → v4 still stamps currency.
    const v2AccountsCsv = [
      "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt",
      "acc-1,Cash,cash,false,false,1,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const v2CategoriesCsv = [
      "id,name,group,archived,sortOrder",
      "cat-1,Rent,Fixed,false,1",
      "cat-2,Food,Daily Living,false,2",
    ].join("\n");
    const v2TransactionsCsv =
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt";

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(oldMeta);
      if (path.endsWith("accounts.csv")) return v2AccountsCsv;
      if (path.endsWith("categories.csv")) return v2CategoriesCsv;
      if (path.endsWith("transactions.csv")) return v2TransactionsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    const result = await detectBudget("/budgets/test");
    expect(result?.schemaVersion).toBe(4);

    // accounts.csv is rewritten only by v3 → v4 (adds currency), not v1 → v2.
    const accountsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("accounts.csv"),
    );
    expect(accountsWrite).toBeDefined();
    expect(accountsWrite![1]).toContain(
      "acc-1,Cash,cash,false,false,1,2026-01-01T00:00:00.000Z,USD",
    );

    // categories.csv gains the `assigned` column with empty cells.
    const categoriesWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("categories.csv"),
    );
    expect(categoriesWrite).toBeDefined();
    const lines = categoriesWrite![1].split(/\r?\n/);
    expect(lines[0]).toBe("id,name,group,archived,sortOrder,assigned");
    expect(lines[1]).toBe("cat-1,Rent,Fixed,false,1,");
    expect(lines[2]).toBe("cat-2,Food,Daily Living,false,2,");
  });

  it("v3 → v4 stamps the budget default currency and leaves fxRate empty", async () => {
    const v3Meta = {
      schemaVersion: 3,
      name: "v3 Budget",
      currency: "EUR",
      currencyDecimals: 2,
      currencySymbolPosition: "before",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    const v3AccountsCsv = [
      "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt",
      "acc-1,Checking,checking,false,false,1,2026-01-01T00:00:00.000Z",
      "acc-2,Cash,cash,false,false,2,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const v3TransactionsCsv = [
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt",
      "txn-1,2026-01-15T12:00:00.000Z,expense,-5000,cat-1,acc-1,,Store,,2026-01-15T00:00:00.000Z",
    ].join("\n");

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(v3Meta);
      if (path.endsWith("accounts.csv")) return v3AccountsCsv;
      if (path.endsWith("transactions.csv")) return v3TransactionsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    const result = await detectBudget("/budgets/v3");
    expect(result?.schemaVersion).toBe(4);

    // accounts.csv gains `currency`, stamped with the budget default for every row.
    const accountsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("accounts.csv"),
    );
    expect(accountsWrite).toBeDefined();
    const accountLines = accountsWrite![1].split(/\r?\n/);
    expect(accountLines[0]).toBe(
      "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt,currency",
    );
    expect(accountLines[1]).toBe(
      "acc-1,Checking,checking,false,false,1,2026-01-01T00:00:00.000Z,EUR",
    );
    expect(accountLines[2]).toBe(
      "acc-2,Cash,cash,false,false,2,2026-01-01T00:00:00.000Z,EUR",
    );

    // transactions.csv gains `fxRate`, empty everywhere (trailing comma).
    const transactionsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("transactions.csv"),
    );
    expect(transactionsWrite).toBeDefined();
    const txnLines = transactionsWrite![1].split(/\r?\n/);
    expect(txnLines[0]).toBe(
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt,fxRate",
    );
    expect(txnLines[1]).toBe(
      "txn-1,2026-01-15T12:00:00.000Z,expense,-5000,cat-1,acc-1,,Store,,2026-01-15T00:00:00.000Z,",
    );
  });

  it("v3 → v4 with no `currency` in budget.json falls back to USD", async () => {
    // A budget.json predating the currency field is still at v3 on disk. The
    // migration resolves the default the same way every reader does → USD.
    const v3Meta = {
      schemaVersion: 3,
      name: "Pre-currency v3",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    const v3AccountsCsv = [
      "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt",
      "acc-1,Checking,checking,false,false,1,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const v3TransactionsCsv =
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt";

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(v3Meta);
      if (path.endsWith("accounts.csv")) return v3AccountsCsv;
      if (path.endsWith("transactions.csv")) return v3TransactionsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    await detectBudget("/budgets/v3-nocurrency");

    const accountsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("accounts.csv"),
    );
    expect(accountsWrite![1]).toContain(
      "acc-1,Checking,checking,false,false,1,2026-01-01T00:00:00.000Z,USD",
    );
  });

  it("v3 → v4 is idempotent — re-running rewrites nothing", async () => {
    const fs = new Map<string, string>();
    fs.set(
      "/budgets/v3/budget.json",
      JSON.stringify({
        schemaVersion: 3,
        name: "v3 Budget",
        currency: "EUR",
        currencyDecimals: 2,
        currencySymbolPosition: "before",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastModified: "2026-01-01T00:00:00.000Z",
      }),
    );
    fs.set(
      "/budgets/v3/accounts.csv",
      [
        "id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt",
        "acc-1,Checking,checking,false,false,1,2026-01-01T00:00:00.000Z",
      ].join("\n"),
    );
    fs.set(
      "/budgets/v3/transactions.csv",
      [
        "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt",
        "txn-1,2026-01-15T12:00:00.000Z,expense,-5000,cat-1,acc-1,,Store,,2026-01-15T00:00:00.000Z",
      ].join("\n"),
    );

    mockExists.mockImplementation(async (path: string) => fs.has(path));
    mockReadTextFile.mockImplementation(async (path: string) => {
      const v = fs.get(path);
      if (v === undefined) throw new Error(`Unexpected read: ${path}`);
      return v;
    });
    mockWriteTextFile.mockImplementation(async (path: string, contents: string) => {
      fs.set(path, contents);
    });

    const first = await detectBudget("/budgets/v3");
    expect(first?.schemaVersion).toBe(4);
    const accountsAfterFirst = fs.get("/budgets/v3/accounts.csv")!;
    const txnsAfterFirst = fs.get("/budgets/v3/transactions.csv")!;
    const metaAfterFirst = fs.get("/budgets/v3/budget.json")!;
    expect(accountsAfterFirst).toContain(",EUR");

    const second = await detectBudget("/budgets/v3");
    expect(second?.schemaVersion).toBe(4);
    expect(fs.get("/budgets/v3/accounts.csv")).toBe(accountsAfterFirst);
    expect(fs.get("/budgets/v3/transactions.csv")).toBe(txnsAfterFirst);
    expect(fs.get("/budgets/v3/budget.json")).toBe(metaAfterFirst);
  });

  it("is idempotent — second detectBudget call is a no-op", async () => {
    // Simulate a real filesystem: writes update the in-memory store, reads
    // pull from it. This is what makes the v1->v2 migration's early-return
    // safe in detectBudget's partial-failure window — re-running on
    // already-migrated data must not rewrite anything.
    const fs = new Map<string, string>();
    fs.set(
      "/budgets/test/budget.json",
      JSON.stringify({
        schemaVersion: 1,
        name: "Old Budget",
        currency: "USD",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastModified: "2026-01-01T00:00:00.000Z",
      }),
    );
    fs.set(
      "/budgets/test/accounts.csv",
      [
        "id,name,type,archived,sortOrder,createdAt",
        "acc-1,Cash,cash,false,1,2026-01-01T00:00:00.000Z",
      ].join("\n"),
    );
    fs.set(
      "/budgets/test/categories.csv",
      [
        "id,name,group,archived,sortOrder",
        "cat-1,Food,Daily Living,false,1",
      ].join("\n"),
    );
    fs.set(
      "/budgets/test/transactions.csv",
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt",
    );

    mockExists.mockImplementation(async (path: string) => fs.has(path));
    mockReadTextFile.mockImplementation(async (path: string) => {
      const v = fs.get(path);
      if (v === undefined) throw new Error(`Unexpected read: ${path}`);
      return v;
    });
    mockWriteTextFile.mockImplementation(async (path: string, contents: string) => {
      fs.set(path, contents);
    });

    // First call: migrates v1 -> v4 (chain).
    const first = await detectBudget("/budgets/test");
    expect(first?.schemaVersion).toBe(4);

    const accountsAfterFirst = fs.get("/budgets/test/accounts.csv")!;
    const categoriesAfterFirst = fs.get("/budgets/test/categories.csv")!;
    const transactionsAfterFirst = fs.get("/budgets/test/transactions.csv")!;
    const metaAfterFirst = fs.get("/budgets/test/budget.json")!;
    expect(accountsAfterFirst).toContain("excludeFromNetWorth");
    expect(accountsAfterFirst).toContain("currency");
    expect(categoriesAfterFirst).toContain("assigned");
    expect(transactionsAfterFirst).toContain("fxRate");

    // Second call on the same folder — files must be byte-identical and
    // schemaVersion must remain at 4. budget.json's lastModified is allowed to
    // refresh, but only because the migration loop ran (it shouldn't here).
    const second = await detectBudget("/budgets/test");
    expect(second?.schemaVersion).toBe(4);

    expect(fs.get("/budgets/test/accounts.csv")).toBe(accountsAfterFirst);
    expect(fs.get("/budgets/test/categories.csv")).toBe(categoriesAfterFirst);
    expect(fs.get("/budgets/test/transactions.csv")).toBe(transactionsAfterFirst);
    // budget.json must also stay byte-identical: when no migrations are
    // pending, detectBudget skips the metadata rewrite entirely.
    expect(fs.get("/budgets/test/budget.json")).toBe(metaAfterFirst);
  });
});

describe("bootstrapBudget", () => {
  beforeEach(() => {
    // resetAllMocks clears both call history AND implementations, ensuring
    // mockExists returns undefined (falsy) unless explicitly set by a test.
    vi.resetAllMocks();
    mockWriteTextFile.mockResolvedValue(undefined);
  });

  it("returns a BudgetMeta with the current schema version", async () => {
    const result = await bootstrapBudget("/new/budget", "My Budget");
    expect(result.schemaVersion).toBe(4);
    expect(result.name).toBe("My Budget");
    expect(result.currency).toBe("USD");
    expect(result.currencyDecimals).toBe(2);
    expect(result.currencySymbolPosition).toBe("before");
    expect(result.createdAt).toBeTruthy();
    expect(result.lastModified).toBeTruthy();
  });

  it("seeds format fields from the chosen currency's defaults", async () => {
    const result = await bootstrapBudget("/new/budget", "Ruble Budget", "RUB");
    expect(result.currencyDecimals).toBe(0);
    expect(result.currencySymbolPosition).toBe("after");
  });

  it("defaults currency to USD when omitted", async () => {
    const result = await bootstrapBudget("/new/budget", "My Budget");
    expect(result.currency).toBe("USD");
  });

  it("honors a passed currency", async () => {
    const result = await bootstrapBudget("/new/budget", "My Budget", "EUR");
    expect(result.currency).toBe("EUR");

    const budgetJsonCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/budget.json",
    );
    expect(JSON.parse(budgetJsonCall![1]).currency).toBe("EUR");
  });

  it("writes budget.json", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const budgetJsonCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/budget.json",
    );
    expect(budgetJsonCall).toBeDefined();

    const written = JSON.parse(budgetJsonCall![1]);
    expect(written.name).toBe("Test");
    expect(written.schemaVersion).toBe(4);
  });

  it("writes categories.csv with default categories", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const categoriesCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/categories.csv",
    );
    expect(categoriesCall).toBeDefined();

    // CSV should have a header row + one row per default category
    const lines = categoriesCall![1].split("\n");
    expect(lines.length).toBe(DEFAULT_CATEGORIES.length + 1);
    // Header advertises the v3 schema with the `assigned` column
    expect(lines[0]).toContain("assigned");
  });

  it("writes empty accounts.csv with header", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const accountsCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/accounts.csv",
    );
    expect(accountsCall).toBeDefined();
    expect(accountsCall![1]).toContain("id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt,currency");
  });

  it("writes empty transactions.csv with header", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const transactionsCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/transactions.csv",
    );
    expect(transactionsCall).toBeDefined();
    expect(transactionsCall![1]).toContain("id,datetime,type,amount,categoryId");
    expect(transactionsCall![1]).toContain("createdAt,fxRate");
  });

  it("writes 4 files total (budget.json + 3 CSVs)", async () => {
    await bootstrapBudget("/new/budget", "Test");
    expect(mockWriteTextFile).toHaveBeenCalledTimes(4);
  });

  it("refuses to overwrite an existing budget.json", async () => {
    // Simulate budget.json already existing in the target folder.
    mockExists.mockImplementation(async (path: string) =>
      path.endsWith("budget.json"),
    );

    await expect(bootstrapBudget("/new/budget", "Second")).rejects.toThrow(
      /Cannot create budget.*budget\.json.*already exists/,
    );
  });

  it("refuses to overwrite existing canonical CSV files", async () => {
    for (const file of ["categories.csv", "accounts.csv", "transactions.csv"]) {
      vi.clearAllMocks();
      mockExists.mockImplementation(async (path: string) => path.endsWith(file));
      await expect(bootstrapBudget("/new/budget", "Test")).rejects.toThrow(
        /Cannot create budget.*already exists/,
      );
    }
  });
});

describe("inspectFolder", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns hasBudget=true when budget.json exists", async () => {
    mockExists.mockResolvedValue(true);
    mockReadDir.mockResolvedValue([{ name: "budget.json" }, { name: "accounts.csv" }]);
    const result = await inspectFolder("/some/folder");
    expect(result.hasBudget).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.itemCount).toBe(2);
  });

  it("returns hasBudget=false, isEmpty=true when folder is empty", async () => {
    mockExists.mockResolvedValue(false);
    mockReadDir.mockResolvedValue([]);
    const result = await inspectFolder("/empty/folder");
    expect(result.hasBudget).toBe(false);
    expect(result.isEmpty).toBe(true);
    expect(result.itemCount).toBe(0);
  });

  it("returns hasBudget=false, isEmpty=false when folder has files but no budget.json", async () => {
    mockExists.mockResolvedValue(false);
    mockReadDir.mockResolvedValue([{ name: "notes.txt" }, { name: "data.csv" }]);
    const result = await inspectFolder("/non-budget/folder");
    expect(result.hasBudget).toBe(false);
    expect(result.isEmpty).toBe(false);
    expect(result.itemCount).toBe(2);
  });

  it("treats hidden-only folders as empty", async () => {
    // User deletes a budget in Finder — `.capy/` and `.DS_Store` survive
    // because Finder hides them. Should still be usable for a new budget.
    mockExists.mockResolvedValue(false);
    mockReadDir.mockResolvedValue([
      { name: ".capy" },
      { name: ".git" },
      { name: ".DS_Store" },
    ]);
    const result = await inspectFolder("/looks/empty");
    expect(result.hasBudget).toBe(false);
    expect(result.isEmpty).toBe(true);
    expect(result.itemCount).toBe(0);
  });
});

describe("findMissingBudgetPaths", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when all paths exist", async () => {
    mockExists.mockResolvedValue(true);
    const missing = await findMissingBudgetPaths(["/a", "/b", "/c"]);
    expect(missing).toEqual([]);
  });

  it("returns paths whose budget.json is missing", async () => {
    mockExists.mockImplementation(async (p: string) => p.startsWith("/keep/"));
    const missing = await findMissingBudgetPaths(["/keep/one", "/gone/two", "/keep/three", "/gone/four"]);
    expect(missing).toEqual(["/gone/two", "/gone/four"]);
  });

  it("treats fs errors as missing (e.g. unmounted external drive)", async () => {
    mockExists.mockImplementation(async (p: string) => {
      if (p.startsWith("/external/")) throw new Error("device not mounted");
      return true;
    });
    const missing = await findMissingBudgetPaths(["/local/a", "/external/b"]);
    expect(missing).toEqual(["/external/b"]);
  });

  it("handles empty input", async () => {
    const missing = await findMissingBudgetPaths([]);
    expect(missing).toEqual([]);
    expect(mockExists).not.toHaveBeenCalled();
  });
});
