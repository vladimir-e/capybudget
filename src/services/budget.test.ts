import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectBudget, bootstrapBudget } from "./budget";
import { DEFAULT_CATEGORIES } from "@capybudget/core";

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
}));

const mockExists = vi.fn();
const mockReadTextFile = vi.fn();
const mockWriteTextFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
  writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
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
      schemaVersion: 2,
      name: "Test Budget",
      currency: "USD",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastModified: "2026-01-01T00:00:00.000Z",
    };
    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockResolvedValue(JSON.stringify(meta));

    const result = await detectBudget("/budgets/test");
    expect(result).toEqual(meta);
    expect(mockReadTextFile).toHaveBeenCalledWith("/budgets/test/budget.json");
  });

  it("runs pending migrations and writes updated budget.json", async () => {
    // budget.json is at v1; accounts.csv has no excludeFromNetWorth column.
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

    mockExists.mockResolvedValue(true);
    mockReadTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("budget.json")) return JSON.stringify(oldMeta);
      if (path.endsWith("accounts.csv")) return oldAccountsCsv;
      throw new Error(`Unexpected read: ${path}`);
    });

    const result = await detectBudget("/budgets/test");

    expect(result?.schemaVersion).toBe(2);

    // Migration rewrote accounts.csv with the new column.
    const accountsWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("accounts.csv"),
    );
    expect(accountsWrite).toBeDefined();
    expect(accountsWrite![1]).toContain("excludeFromNetWorth");
    expect(accountsWrite![1]).toContain("acc-1,Cash,cash,false,false,1");

    // budget.json was rewritten with the new schemaVersion.
    const metaWrite = mockWriteTextFile.mock.calls.find((c: string[]) =>
      c[0].endsWith("budget.json"),
    );
    expect(metaWrite).toBeDefined();
    expect(JSON.parse(metaWrite![1]).schemaVersion).toBe(2);
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

    mockExists.mockImplementation(async (path: string) => fs.has(path));
    mockReadTextFile.mockImplementation(async (path: string) => {
      const v = fs.get(path);
      if (v === undefined) throw new Error(`Unexpected read: ${path}`);
      return v;
    });
    mockWriteTextFile.mockImplementation(async (path: string, contents: string) => {
      fs.set(path, contents);
    });

    // First call: migrates v1 -> v2.
    const first = await detectBudget("/budgets/test");
    expect(first?.schemaVersion).toBe(2);

    const accountsAfterFirst = fs.get("/budgets/test/accounts.csv")!;
    const metaAfterFirst = fs.get("/budgets/test/budget.json")!;
    expect(accountsAfterFirst).toContain("excludeFromNetWorth");

    // Second call on the same folder — accounts.csv must be byte-identical and
    // schemaVersion must remain at 2. budget.json's lastModified is allowed to
    // refresh, but only because the migration loop ran (it shouldn't here).
    const second = await detectBudget("/budgets/test");
    expect(second?.schemaVersion).toBe(2);

    expect(fs.get("/budgets/test/accounts.csv")).toBe(accountsAfterFirst);
    // budget.json must also stay byte-identical: when no migrations are
    // pending, detectBudget skips the metadata rewrite entirely.
    expect(fs.get("/budgets/test/budget.json")).toBe(metaAfterFirst);
  });
});

describe("bootstrapBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a BudgetMeta with the current schema version", async () => {
    const result = await bootstrapBudget("/new/budget", "My Budget");
    expect(result.schemaVersion).toBe(2);
    expect(result.name).toBe("My Budget");
    expect(result.currency).toBe("USD");
    expect(result.createdAt).toBeTruthy();
    expect(result.lastModified).toBeTruthy();
  });

  it("creates the directory recursively", async () => {
    await bootstrapBudget("/new/budget", "Test");
    expect(mockMkdir).toHaveBeenCalledWith("/new/budget", { recursive: true });
  });

  it("writes budget.json", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const budgetJsonCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/budget.json",
    );
    expect(budgetJsonCall).toBeDefined();

    const written = JSON.parse(budgetJsonCall![1]);
    expect(written.name).toBe("Test");
    expect(written.schemaVersion).toBe(2);
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
  });

  it("writes empty accounts.csv with header", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const accountsCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/accounts.csv",
    );
    expect(accountsCall).toBeDefined();
    expect(accountsCall![1]).toContain("id,name,type,archived,excludeFromNetWorth,sortOrder,createdAt");
  });

  it("writes empty transactions.csv with header", async () => {
    await bootstrapBudget("/new/budget", "Test");

    const transactionsCall = mockWriteTextFile.mock.calls.find(
      (call: string[]) => call[0] === "/new/budget/transactions.csv",
    );
    expect(transactionsCall).toBeDefined();
    expect(transactionsCall![1]).toContain("id,datetime,type,amount,categoryId");
  });

  it("writes 4 files total (budget.json + 3 CSVs)", async () => {
    await bootstrapBudget("/new/budget", "Test");
    expect(mockWriteTextFile).toHaveBeenCalledTimes(4);
  });
});
