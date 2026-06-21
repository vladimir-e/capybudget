import { describe, it, expect } from "vitest";
import type { Account, Category, Transaction } from "@capybudget/core";
import {
  parseCsv,
  unparseCsv,
  ACCOUNT_COERCE,
  CATEGORY_COERCE,
  TRANSACTION_COERCE,
  ACCOUNT_COLUMNS,
  CATEGORY_COLUMNS,
  TRANSACTION_COLUMNS,
  type CoercionMap,
} from "./csv-parse";

describe("parseCsv", () => {
  it("parses valid CSV into typed objects", () => {
    const csv = "id,name,group,archived,sortOrder,assigned\ncat-1,Food,Daily Living,false,1,";
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "cat-1",
      name: "Food",
      group: "Daily Living",
      archived: false,
      sortOrder: 1,
      assigned: null,
    });
  });

  it("parses multiple rows", () => {
    const csv = [
      "id,name,group,archived,sortOrder",
      "cat-1,Food,Daily Living,false,1",
      "cat-2,Rent,Fixed,false,2",
      "cat-3,Old,Personal,true,3",
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Food");
    expect(result[1].name).toBe("Rent");
    expect(result[2].name).toBe("Old");
  });

  it("defaults excludeFromNetWorth to false when the column is absent (legacy CSV)", () => {
    const csv = [
      "id,name,type,archived,sortOrder,createdAt",
      "acc-1,Cash,cash,false,1,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const result = parseCsv<Account>(csv, ACCOUNT_COERCE);

    expect(result[0].excludeFromNetWorth).toBe(false);
  });

  it("defaults assigned to null when the column is absent (pre-v3 CSV)", () => {
    const csv = [
      "id,name,group,archived,sortOrder",
      "cat-1,Food,Daily Living,false,1",
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].assigned).toBeNull();
  });

  it("defaults assigned to null when the cell is empty", () => {
    const csv = [
      "id,name,group,archived,sortOrder,assigned",
      "cat-1,Food,Daily Living,false,1,",
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].assigned).toBeNull();
  });

  it("parses assigned as integer cents when present", () => {
    const csv = [
      "id,name,group,archived,sortOrder,assigned",
      "cat-1,Rent,Fixed,false,1,350000",
      "cat-2,Zero,Personal,false,2,0",
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].assigned).toBe(350000);
    expect(typeof result[0].assigned).toBe("number");
    // Tracked-at-zero must round-trip as 0, not null
    expect(result[1].assigned).toBe(0);
  });

  it("coerces boolean fields correctly", () => {
    const csv = [
      "id,name,type,archived,sortOrder,createdAt",
      "acc-1,Cash,cash,false,1,2026-01-01T00:00:00.000Z",
      "acc-2,Savings,savings,true,2,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const result = parseCsv<Account>(csv, ACCOUNT_COERCE);

    expect(result[0].archived).toBe(false);
    expect(typeof result[0].archived).toBe("boolean");
    expect(result[1].archived).toBe(true);
    expect(typeof result[1].archived).toBe("boolean");
  });

  it("coerces integer fields correctly", () => {
    const csv = [
      "id,name,type,archived,sortOrder,createdAt",
      "acc-1,Cash,cash,false,42,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const result = parseCsv<Account>(csv, ACCOUNT_COERCE);

    expect(result[0].sortOrder).toBe(42);
    expect(typeof result[0].sortOrder).toBe("number");
  });

  it("coerces negative amounts for transactions", () => {
    const csv = [
      "id,datetime,type,amount,categoryId,accountId,transferPairId,merchant,note,createdAt",
      "txn-1,2026-01-15T00:00:00.000Z,expense,-5000,cat-1,acc-1,,Store,,2026-01-15T00:00:00.000Z",
    ].join("\n");
    const result = parseCsv<Transaction>(csv, TRANSACTION_COERCE);

    expect(result[0].amount).toBe(-5000);
    expect(typeof result[0].amount).toBe("number");
  });

  it("returns empty array for headers-only CSV", () => {
    const csv = "id,name,group,archived,sortOrder";
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    const result = parseCsv<Category>("", CATEGORY_COERCE);

    expect(result).toEqual([]);
  });

  it("leaves fields without coercion as strings", () => {
    const csv = [
      "id,name,type,archived,sortOrder,createdAt",
      "acc-1,Cash,cash,false,1,2026-01-01T00:00:00.000Z",
    ].join("\n");
    const result = parseCsv<Account>(csv, ACCOUNT_COERCE);

    expect(typeof result[0].id).toBe("string");
    expect(typeof result[0].name).toBe("string");
    expect(typeof result[0].type).toBe("string");
    expect(typeof result[0].createdAt).toBe("string");
  });

  it("handles quoted fields containing commas", () => {
    const csv = [
      "id,name,group,archived,sortOrder",
      'cat-1,"Food, Drink",Daily Living,false,1',
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].name).toBe("Food, Drink");
  });

  it("handles quoted fields containing newlines", () => {
    const csv =
      'id,name,group,archived,sortOrder\ncat-1,"Multi\nLine",Daily Living,false,1';
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].name).toBe("Multi\nLine");
  });

  it("handles quoted fields containing double quotes", () => {
    const csv = [
      "id,name,group,archived,sortOrder",
      'cat-1,"Say ""hello""",Daily Living,false,1',
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result[0].name).toBe('Say "hello"');
  });

  it("skips empty lines in CSV", () => {
    const csv = [
      "id,name,group,archived,sortOrder",
      "cat-1,Food,Daily Living,false,1",
      "",
      "cat-2,Rent,Fixed,false,2",
      "",
    ].join("\n");
    const result = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(result).toHaveLength(2);
  });

  it("works with an empty coercion map", () => {
    const csv = "id,name\nrow-1,Hello";
    const result = parseCsv<{ id: string; name: string }>(csv, {});

    expect(result).toEqual([{ id: "row-1", name: "Hello" }]);
  });

  it("applies coercion for missing columns so new fields get defaults", () => {
    // Forward-compat: when a budget file predates a new field, the column is
    // absent from the CSV. The coercion fn is still called with `undefined`
    // and is responsible for producing a sensible default.
    const csv = "id,name\nrow-1,Test";
    const coerce: CoercionMap<{ id: string; name: string; flag: boolean }> = {
      flag: (v) => v === "true", // undefined → false
    };
    const result = parseCsv<{ id: string; name: string; flag: boolean }>(csv, coerce);

    expect(result).toEqual([{ id: "row-1", name: "Test", flag: false }]);
  });
});

describe("unparseCsv", () => {
  it("converts array of objects to CSV string with headers", () => {
    const data = [{ id: "1", name: "Alice" }];
    const csv = unparseCsv(data, ["id", "name"]);

    expect(csv).toBe("id,name\r\n1,Alice");
  });

  it("handles multiple rows", () => {
    const data = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];
    const csv = unparseCsv(data, ["id", "name"]);
    const lines = csv.split("\r\n");

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("id,name");
    expect(lines[1]).toBe("1,Alice");
    expect(lines[2]).toBe("2,Bob");
  });

  it("writes columns in the given order regardless of object key order", () => {
    const data = [{ name: "Alice", id: "1" }];
    const csv = unparseCsv(data, ["id", "name"]);

    expect(csv).toBe("id,name\r\n1,Alice");
  });

  it("returns empty string for empty array", () => {
    const csv = unparseCsv([], ["id", "name"]);

    expect(csv).toBe("");
  });

  it("escapes fields containing commas", () => {
    const data = [{ id: "1", name: "Doe, Jane" }];
    const csv = unparseCsv(data, ["id", "name"]);

    expect(csv).toContain('"Doe, Jane"');
  });

  it("escapes fields containing double quotes", () => {
    const data = [{ id: "1", name: 'Say "hello"' }];
    const csv = unparseCsv(data, ["id", "name"]);

    expect(csv).toContain('"Say ""hello"""');
  });

  it("escapes fields containing newlines", () => {
    const data = [{ id: "1", note: "line1\nline2" }];
    const csv = unparseCsv(data, ["id", "note"]);

    expect(csv).toContain('"line1\nline2"');
  });

  it("handles boolean and number values", () => {
    const data = [{ id: "acc-1", archived: false, sortOrder: 3 }];
    const csv = unparseCsv(data, ["id", "archived", "sortOrder"]);
    const lines = csv.split("\r\n");

    expect(lines[1]).toBe("acc-1,false,3");
  });
});

describe("round-trip: parseCsv(unparseCsv(data))", () => {
  it("preserves Account data through round-trip", () => {
    const accounts: Account[] = [
      {
        id: "acc-1",
        name: "Checking",
        type: "checking",
        archived: false,
        excludeFromNetWorth: false,
        sortOrder: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        currency: "USD",
      },
      {
        id: "acc-2",
        name: "Euro Savings",
        type: "savings",
        archived: true,
        excludeFromNetWorth: true,
        sortOrder: 2,
        createdAt: "2026-02-01T00:00:00.000Z",
        currency: "EUR",
      },
    ];

    const csv = unparseCsv(accounts, ACCOUNT_COLUMNS);
    const restored = parseCsv<Account>(csv, ACCOUNT_COERCE);

    expect(restored).toEqual(accounts);
  });

  it("preserves Category data through round-trip", () => {
    const categories: Category[] = [
      { id: "cat-1", name: "Groceries", group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
      { id: "cat-2", name: "Mortgage", group: "Fixed", archived: false, sortOrder: 2, assigned: 350000 },
    ];

    const csv = unparseCsv(categories, CATEGORY_COLUMNS);
    const restored = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(restored).toEqual(categories);
  });

  it("preserves Transaction data through round-trip", () => {
    const transactions: Transaction[] = [
      {
        id: "txn-1",
        datetime: "2026-01-15T12:00:00.000Z",
        type: "expense",
        amount: -4250,
        categoryId: "cat-1",
        accountId: "acc-1",
        transferPairId: "",
        merchant: "Grocery Store",
        note: "Weekly shopping",
        createdAt: "2026-01-15T12:00:00.000Z",
      },
      {
        id: "txn-2",
        datetime: "2026-01-16T12:00:00.000Z",
        type: "expense",
        amount: -100000,
        categoryId: "cat-1",
        accountId: "acc-2",
        transferPairId: "",
        merchant: "Магазин",
        note: "",
        createdAt: "2026-01-16T12:00:00.000Z",
        fxRate: 0.011,
      },
    ];

    const csv = unparseCsv(transactions, TRANSACTION_COLUMNS);
    const restored = parseCsv<Transaction>(csv, TRANSACTION_COERCE);

    expect(restored).toEqual(transactions);
    // A default-currency transaction leaves fxRate empty → undefined on read.
    expect(restored[0].fxRate).toBeUndefined();
    // A stamped foreign rate round-trips as a number.
    expect(restored[1].fxRate).toBe(0.011);
  });

  it("preserves fields with special characters through round-trip", () => {
    const categories: Category[] = [
      { id: "cat-1", name: 'Food, "Drink" & More', group: "Daily Living", archived: false, sortOrder: 1, assigned: null },
    ];

    const csv = unparseCsv(categories, CATEGORY_COLUMNS);
    const restored = parseCsv<Category>(csv, CATEGORY_COERCE);

    expect(restored[0].name).toBe('Food, "Drink" & More');
  });
});
