import { describe, expect, it } from "vitest";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  archiveCategory,
  unarchiveCategory,
} from "./categories";
import type { Category, Transaction } from "./types";

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: crypto.randomUUID(),
    name: "Groceries",
    group: "Daily Living",
    archived: false,
    sortOrder: 1,
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

describe("createCategory", () => {
  it("assigns a UUID id", () => {
    const result = createCategory({ name: "New", group: "Income" }, []);
    const created = result[0];
    expect(created.id).toBeDefined();
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("sets archived to false", () => {
    const result = createCategory({ name: "New", group: "Income" }, []);
    expect(result[0].archived).toBe(false);
  });

  it("sets sortOrder to 1 when group is empty", () => {
    const result = createCategory({ name: "New", group: "Income" }, []);
    expect(result[0].sortOrder).toBe(1);
  });

  it("sets sortOrder to max + 1 within the same group", () => {
    const existing = [
      makeCategory({ id: "a", group: "Income", sortOrder: 3 }),
      makeCategory({ id: "b", group: "Income", sortOrder: 7 }),
      makeCategory({ id: "c", group: "Fixed", sortOrder: 10 }),
    ];
    const result = createCategory({ name: "New", group: "Income" }, existing);
    const created = result.find((c) => c.name === "New")!;
    expect(created.sortOrder).toBe(8);
  });

  it("appends to existing list without modifying it", () => {
    const existing = [makeCategory()];
    const result = createCategory({ name: "New", group: "Income" }, existing);
    expect(result).toHaveLength(2);
    expect(existing).toHaveLength(1);
  });
});

describe("updateCategory", () => {
  it("updates name and group", () => {
    const existing = [
      makeCategory({ id: "cat-1", name: "Old", group: "Fixed" }),
    ];
    const result = updateCategory(
      { id: "cat-1", name: "Renamed", group: "Income" },
      existing,
    );
    expect(result[0].name).toBe("Renamed");
    expect(result[0].group).toBe("Income");
  });

  it("does not modify other categories", () => {
    const existing = [
      makeCategory({ id: "cat-1", name: "A" }),
      makeCategory({ id: "cat-2", name: "B" }),
    ];
    const result = updateCategory(
      { id: "cat-1", name: "Updated", group: "Income" },
      existing,
    );
    expect(result[1].name).toBe("B");
  });

  it("preserves sortOrder and archived", () => {
    const existing = [
      makeCategory({
        id: "cat-1",
        sortOrder: 5,
        archived: true,
      }),
    ];
    const result = updateCategory(
      { id: "cat-1", name: "X", group: "Income" },
      existing,
    );
    expect(result[0].sortOrder).toBe(5);
    expect(result[0].archived).toBe(true);
  });
});

describe("deleteCategory", () => {
  it("removes the category from the list", () => {
    const categories = [
      makeCategory({ id: "cat-1" }),
      makeCategory({ id: "cat-2" }),
    ];
    const result = deleteCategory("cat-1", categories, []);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].id).toBe("cat-2");
  });

  it("clears categoryId on referencing transactions", () => {
    const categories = [makeCategory({ id: "cat-1" })];
    const transactions = [
      makeTxn({ id: "t1", categoryId: "cat-1" }),
      makeTxn({ id: "t2", categoryId: "cat-2" }),
    ];
    const result = deleteCategory("cat-1", categories, transactions);
    expect(result.transactions[0].categoryId).toBe("");
    expect(result.transactions[1].categoryId).toBe("cat-2");
  });

  it("returns both updated arrays", () => {
    const result = deleteCategory("cat-1", [makeCategory()], [makeTxn()]);
    expect(result).toHaveProperty("categories");
    expect(result).toHaveProperty("transactions");
  });
});

describe("archiveCategory", () => {
  it("sets archived to true", () => {
    const existing = [makeCategory({ id: "cat-1", archived: false })];
    const result = archiveCategory("cat-1", existing);
    expect(result[0].archived).toBe(true);
  });

  it("does not affect other categories", () => {
    const existing = [
      makeCategory({ id: "cat-1", archived: false }),
      makeCategory({ id: "cat-2", archived: false }),
    ];
    const result = archiveCategory("cat-1", existing);
    expect(result[1].archived).toBe(false);
  });
});

describe("unarchiveCategory", () => {
  it("sets archived to false", () => {
    const existing = [makeCategory({ id: "cat-1", archived: true })];
    const result = unarchiveCategory("cat-1", existing);
    expect(result[0].archived).toBe(false);
  });

  it("does not affect other categories", () => {
    const existing = [
      makeCategory({ id: "cat-1", archived: true }),
      makeCategory({ id: "cat-2", archived: true }),
    ];
    const result = unarchiveCategory("cat-1", existing);
    expect(result[1].archived).toBe(true);
  });
});

