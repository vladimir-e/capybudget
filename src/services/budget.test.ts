import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectBudget, bootstrapBudget } from "@/services/budget";
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

  it("returns parsed BudgetMeta when budget.json exists", async () => {
    const meta = {
      schemaVersion: 1,
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
});

describe("bootstrapBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a BudgetMeta with schema version 1", async () => {
    const result = await bootstrapBudget("/new/budget", "My Budget");
    expect(result.schemaVersion).toBe(1);
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
    expect(written.schemaVersion).toBe(1);
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
    expect(accountsCall![1]).toContain("id,name,type,archived,sortOrder,createdAt");
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
