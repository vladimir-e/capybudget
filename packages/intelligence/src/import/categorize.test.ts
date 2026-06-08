import { describe, it, expect } from "vitest";
import { makeCategory, makeImportTransaction } from "@capybudget/core/test-factories";
import type { RowContext } from "@capybudget/core";
import { batchRows, enrichBatch, needsEnrich, ENRICH_BATCH_SIZE } from "./categorize";
import { ENRICH_BATCH_SCHEMA } from "./schemas";
import { MockStructuredSession } from "./test-doubles";

describe("needsEnrich", () => {
  it("is true for a row missing merchant or category", () => {
    expect(needsEnrich(makeImportTransaction({ merchant: "", categoryId: "" }))).toBe(true);
    expect(needsEnrich(makeImportTransaction({ merchant: "X", categoryId: "" }))).toBe(true);
    expect(needsEnrich(makeImportTransaction({ merchant: "", categoryId: "c" }))).toBe(true);
  });

  it("is false for a fully resolved row", () => {
    expect(needsEnrich(makeImportTransaction({ merchant: "X", categoryId: "c" }))).toBe(false);
  });

  it("is false for transfers (no merchant/category by design)", () => {
    expect(needsEnrich(makeImportTransaction({ type: "transfer", merchant: "", categoryId: "" }))).toBe(false);
  });

  it("is false for a duplicate even when it has no carried category", () => {
    // A dup of an uncategorized historical txn: missing merchant + category, but
    // the `!duplicate` term keeps it out of the classifier.
    expect(needsEnrich(makeImportTransaction({ duplicate: true, merchant: "", categoryId: "" }))).toBe(false);
  });
});

describe("batchRows", () => {
  it("splits into fixed-size batches", () => {
    const rows = Array.from({ length: 55 }, (_, i) => i);
    const batches = batchRows(rows);
    expect(batches.map((b) => b.length)).toEqual([ENRICH_BATCH_SIZE, ENRICH_BATCH_SIZE, 5]);
  });

  it("returns one batch for fewer than the batch size", () => {
    expect(batchRows([1, 2, 3])).toEqual([[1, 2, 3]]);
  });

  it("returns no batches for an empty list", () => {
    expect(batchRows([])).toEqual([]);
  });
});

describe("enrichBatch", () => {
  const categories = [
    makeCategory({ id: "cat-1", name: "Groceries", group: "Daily Living" }),
    makeCategory({ id: "cat-2", name: "Dining", group: "Personal" }),
    makeCategory({ id: "cat-subs", name: "Subscriptions", group: "Fixed" }),
    makeCategory({ id: "inc-1", name: "Paycheck", group: "Income" }),
    makeCategory({ id: "inc-2", name: "Other Income", group: "Income" }),
  ];

  it("maps returned category names → ids, restricted to batch ids", async () => {
    const batch = [makeImportTransaction({ id: "imp-1" }), makeImportTransaction({ id: "imp-2" })];
    const session = new MockStructuredSession([
      () => ({
        rows: [
          { id: "imp-1", merchant: "A", category: "Groceries", confidence: "high" },
          { id: "imp-2", merchant: "B", category: "Dining", confidence: "low" },
          { id: "imp-99", merchant: "Ghost", category: "Groceries", confidence: "low" }, // not in batch — dropped
          { id: "imp-1", merchant: "C", category: "Nonexistent", confidence: "low" }, // unknown name — left uncategorized
        ],
      }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result.map((r) => r.id)).toEqual(["imp-1", "imp-2", "imp-1"]);
    expect(result.map((r) => r.categoryId)).toEqual(["cat-1", "cat-2", ""]);
    expect(session.calls[0].schema).toBe(ENRICH_BATCH_SCHEMA);
  });

  it("resolves a returned name case-insensitively", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "expense" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "A", category: "  groceries ", confidence: "high" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result[0].categoryId).toBe("cat-1");
  });

  it("leaves the row uncategorized for an unknown/hallucinated name", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "expense" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "A", category: "Magic Beans", confidence: "low" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result).toEqual([{ id: "imp-1", merchant: "A", categoryId: "", confidence: "low" }]);
  });

  it("won't resolve an Income-group name on an expense row (cross-type blocked)", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "expense" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "A", category: "Paycheck", confidence: "low" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result[0].categoryId).toBe("");
  });

  it("won't resolve an expense-group name on an income row (cross-type blocked)", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "income" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "A", category: "Groceries", confidence: "low" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result[0].categoryId).toBe("");
  });

  it("keeps a valid Income name on an income row", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "income" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "Employer", category: "Paycheck", confidence: "high" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result[0].categoryId).toBe("inc-1");
  });

  it("keeps a valid expense name on an expense row", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", type: "expense" })];
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "Store", category: "Groceries", confidence: "high" }] }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result[0].categoryId).toBe("cat-1");
  });

  it("an Apple-Services-style row resolves to its history category, not the bank's coarse label", async () => {
    // sourceCategory "Other" + history dominated by Subscriptions: the model is
    // handed names + a history-leads prompt and must pick the history category,
    // never mapping "Other" → "Other Income".
    const batch = [
      makeImportTransaction({
        id: "imp-1",
        type: "expense",
        description: "APPLE.COM/BILL",
        sourceCategory: "Other",
      }),
    ];
    const context: Record<string, RowContext> = {
      "imp-1": {
        examples: [{ date: "2026-05-01", merchant: "Apple", categoryId: "cat-subs", amount: -999 }],
        merchantStats: [{ name: "Apple", count: 218 }],
        categoryStats: [{ name: "cat-subs", count: 218 }],
      },
    };
    // A correct model, reading names + history-leads, returns the history category.
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", merchant: "Apple", category: "Subscriptions", confidence: "high" }] }),
    ]);

    const result = await enrichBatch(session, batch, context, categories);

    expect(result[0].categoryId).toBe("cat-subs");

    // The prompt must lead with history and frame "Other" as a non-category.
    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("PRIMARY SIGNAL");
    expect(text).toContain("Subscriptions");
    expect(text).toContain("(x218)");
    expect(text).toMatch(/"Other" is NOT a category|never let it override/);
  });

  it("presents categories by name + group, never by id", async () => {
    const batch = [makeImportTransaction({ id: "imp-1" })];
    const session = new MockStructuredSession([() => ({ rows: [] })]);

    await enrichBatch(session, batch, {}, categories);

    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("Income categories");
    expect(text).toContain("Expense categories");
    expect(text).toContain("Paycheck (Income)");
    expect(text).toContain("Groceries (Daily Living)");
  });

  it("renders history examples + counts by category name, with no dead-id 'unknown'", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", description: "WF MARKET" })];
    const context: Record<string, RowContext> = {
      "imp-1": {
        examples: [{ date: "2026-01-01", merchant: "Whole Foods", note: "WF", categoryId: "cat-1", amount: -100 }],
        merchantStats: [{ name: "Whole Foods", count: 3 }],
        categoryStats: [{ name: "cat-1", count: 3 }],
      },
    };
    const session = new MockStructuredSession([() => ({ rows: [] })]);

    await enrichBatch(session, batch, context, categories);

    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("Groceries");
    expect(text).toContain("Whole Foods");
    expect(text).toContain("WF MARKET");
    expect(text).not.toContain("unknown");
  });

  it("the rendered prompt contains no UUID-looking strings", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", description: "WF MARKET" })];
    const context: Record<string, RowContext> = {
      "imp-1": {
        examples: [{ date: "2026-01-01", merchant: "Whole Foods", categoryId: "cat-1", amount: -100 }],
        merchantStats: [{ name: "Whole Foods", count: 3 }],
        categoryStats: [{ name: "cat-1", count: 3 }],
      },
    };
    const session = new MockStructuredSession([() => ({ rows: [] })]);

    await enrichBatch(session, batch, context, categories);

    // Only the row `id` (a UUID-shaped staging id) may appear — strip it, then
    // assert nothing UUID-shaped survives in what describes categories/history.
    const prompt = (session.calls[0].messages[0].content as string).replace(/imp-1/g, "");
    expect(prompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("propagates a thrown call so the caller can isolate the failure", async () => {
    const session = new MockStructuredSession([() => new Error("boom")]);
    await expect(enrichBatch(session, [makeImportTransaction({ id: "imp-1" })], {}, categories)).rejects.toThrow("boom");
  });
});
