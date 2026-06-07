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
  const categories = [makeCategory({ id: "cat-1", name: "Groceries" }), makeCategory({ id: "cat-2", name: "Dining" })];

  it("returns the classifier's rows, validated against the batch ids + categories", async () => {
    const batch = [makeImportTransaction({ id: "imp-1" }), makeImportTransaction({ id: "imp-2" })];
    const session = new MockStructuredSession([
      () => ({
        rows: [
          { id: "imp-1", merchant: "A", categoryId: "cat-1", confidence: "high" },
          { id: "imp-2", merchant: "B", categoryId: "cat-2", confidence: "low" },
          { id: "imp-99", merchant: "Ghost", categoryId: "cat-1", confidence: "low" }, // not in batch
          { id: "imp-1", merchant: "C", categoryId: "cat-bad", confidence: "low" }, // bad category
        ],
      }),
    ]);

    const result = await enrichBatch(session, batch, {}, categories);

    expect(result.map((r) => r.id)).toEqual(["imp-1", "imp-2"]);
    expect(session.calls[0].schema).toBe(ENRICH_BATCH_SCHEMA);
  });

  it("embeds row context and the category list in the prompt", async () => {
    const batch = [makeImportTransaction({ id: "imp-1", description: "WF MARKET" })];
    const context: Record<string, RowContext> = {
      "imp-1": {
        examples: [{ date: "2026-01-01", merchant: "Whole Foods", note: "WF", categoryId: "cat-1", amount: -100 }],
        merchantStats: [{ name: "Whole Foods", count: 3 }],
        categoryStats: [{ name: "Groceries", count: 3 }],
      },
    };
    const session = new MockStructuredSession([() => ({ rows: [] })]);

    await enrichBatch(session, batch, context, categories);

    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("cat-1");
    expect(text).toContain("Groceries");
    expect(text).toContain("Whole Foods");
    expect(text).toContain("WF MARKET");
  });

  it("propagates a thrown call so the caller can isolate the failure", async () => {
    const session = new MockStructuredSession([() => new Error("boom")]);
    await expect(enrichBatch(session, [makeImportTransaction({ id: "imp-1" })], {}, categories)).rejects.toThrow("boom");
  });
});
