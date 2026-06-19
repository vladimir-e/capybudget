import { describe, it, expect } from "vitest";
import { makeAccount, makeCategory, makeImportTransaction } from "@capybudget/core/test-factories";
import type { RowContext, TransferContext } from "@capybudget/core";
import {
  batchRows,
  enrichBatch,
  enrichTransfers,
  needsEnrich,
  needsTransferEnrich,
  ENRICH_BATCH_SIZE,
} from "./categorize";
import { ENRICH_BATCH_SCHEMA, ENRICH_TRANSFER_SCHEMA } from "./schemas";
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

  it("instructs an exact, untranslated category name and a source-language merchant", async () => {
    // Canonical-data contract: the category must match a stored name by exact
    // string and the stored merchant is source-faithful, so the prompt forbids
    // translating either — a localized field would break name-matching / corrupt
    // the stored CSV.
    const batch = [makeImportTransaction({ id: "imp-1" })];
    const session = new MockStructuredSession([() => ({ rows: [] })]);

    await enrichBatch(session, batch, {}, categories);

    const text = (session.calls[0].messages[0].content as string);
    expect(text).toMatch(/EXACT name/);
    expect(text).toMatch(/do not translate/i);
    expect(text).toMatch(/source statement's own language/i);
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

describe("needsTransferEnrich", () => {
  const ctxRow = makeImportTransaction({ type: "transfer", targetAccountId: "" });

  it("is true for a transfer with context and no counterpart yet", () => {
    expect(needsTransferEnrich(ctxRow, true)).toBe(true);
  });

  it("is false without transfer context (nothing to ground a pick on)", () => {
    expect(needsTransferEnrich(ctxRow, false)).toBe(false);
  });

  it("is false once a counterpart is set (idempotent — never re-asks)", () => {
    expect(needsTransferEnrich(makeImportTransaction({ type: "transfer", targetAccountId: "acct-1" }), true)).toBe(false);
  });

  it("is false for a duplicate transfer", () => {
    expect(needsTransferEnrich(makeImportTransaction({ type: "transfer", duplicate: true }), true)).toBe(false);
  });

  it("is false for non-transfer rows", () => {
    expect(needsTransferEnrich(makeImportTransaction({ type: "expense" }), true)).toBe(false);
    expect(needsTransferEnrich(makeImportTransaction({ type: "income" }), true)).toBe(false);
  });
});

describe("enrichTransfers", () => {
  const CHECKING = makeAccount({ id: "acct-checking", name: "BofA Checking", type: "checking" });
  const SAVINGS = makeAccount({ id: "acct-savings", name: "BofA Savings", type: "savings" });
  const BROKERAGE = makeAccount({ id: "acct-brokerage", name: "Fidelity Brokerage", type: "asset" });
  const accounts = [CHECKING, SAVINGS, BROKERAGE];

  /** A transfer row already resolved to its own account (Checking), needing a
   *  counterpart. Inflow → the model picks the "from" account. */
  const row = makeImportTransaction({
    id: "imp-1", type: "transfer", description: "ACH BOFA SAV 123",
    amount: 50000, accountId: "acct-checking",
  });
  const context: Record<string, TransferContext> = {
    "imp-1": {
      recentTransfers: [
        { account: "BofA Checking", amount: 50000 },
        { account: "BofA Savings", amount: 50000 },
      ],
      topAccounts: [
        { account: "BofA Checking", count: 28 },
        { account: "BofA Savings", count: 3 },
      ],
    },
  };

  it("maps a returned account name → targetAccountId, restricted to batch ids", async () => {
    const session = new MockStructuredSession([
      () => ({
        rows: [
          { id: "imp-1", account: "BofA Savings", confidence: "high" },
          { id: "imp-99", account: "BofA Savings", confidence: "low" }, // not in batch — dropped
        ],
      }),
    ]);

    const result = await enrichTransfers(session, [row], context, accounts);

    expect(result).toEqual([{ id: "imp-1", targetAccountId: "acct-savings", confidence: "high" }]);
    expect(session.calls[0].schema).toBe(ENRICH_TRANSFER_SCHEMA);
  });

  it("resolves the name case-insensitively", async () => {
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "  bofa savings ", confidence: "high" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, accounts);
    expect(result[0].targetAccountId).toBe("acct-savings");
  });

  it("can pick a non-top counterpart — the occasional-savings case", async () => {
    // Checking is the far more frequent partner (28 vs 3), but the description
    // "ACH BOFA SAV 123" names savings. The model, reading the description over
    // raw frequency, picks BofA Savings — and the mapping honors it.
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "BofA Savings", confidence: "high" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, accounts);
    expect(result[0].targetAccountId).toBe("acct-savings");
    expect(result[0].targetAccountId).not.toBe("acct-checking"); // not the frequency prior
  });

  it("returns blank for an empty pick (model unsure)", async () => {
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "", confidence: "low" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, accounts);
    expect(result[0].targetAccountId).toBe("");
  });

  it("returns blank for an unknown/hallucinated account name", async () => {
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "Imaginary Vault", confidence: "low" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, accounts);
    expect(result[0].targetAccountId).toBe("");
  });

  it("never returns the row's own account as the counterpart", async () => {
    // The model wrongly echoes the statement's own account — blocked.
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "BofA Checking", confidence: "high" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, accounts);
    expect(result[0].targetAccountId).toBe("");
  });

  it("won't resolve to an archived account", async () => {
    const archived = makeAccount({ id: "acct-old", name: "Closed Account", archived: true });
    const session = new MockStructuredSession([
      () => ({ rows: [{ id: "imp-1", account: "Closed Account", confidence: "high" }] }),
    ]);
    const result = await enrichTransfers(session, [row], context, [...accounts, archived]);
    expect(result[0].targetAccountId).toBe("");
  });

  it("hands the model the row's context by account name, with the direction need", async () => {
    const session = new MockStructuredSession([() => ({ rows: [] })]);
    await enrichTransfers(session, [row], context, accounts);

    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("ACH BOFA SAV 123");
    expect(text).toContain("BofA Savings");
    expect(text).toContain("topAccounts");
    expect(text).toContain("recentTransfers");
    expect(text).toContain("from-account"); // inflow → pick where money came FROM
  });

  it("marks an outflow row as needing a to-account", async () => {
    const outflow = makeImportTransaction({
      id: "imp-2", type: "transfer", description: "ONLINE XFER", amount: -25000, accountId: "acct-checking",
    });
    const session = new MockStructuredSession([() => ({ rows: [] })]);
    await enrichTransfers(session, [outflow], { "imp-2": context["imp-1"] }, accounts);

    expect(JSON.stringify(session.calls[0].messages)).toContain("to-account");
  });

  it("the rendered prompt contains no UUID-looking strings (account ids hidden)", async () => {
    const session = new MockStructuredSession([() => ({ rows: [] })]);
    await enrichTransfers(session, [row], context, accounts);

    const prompt = (session.calls[0].messages[0].content as string).replace(/imp-\d+/g, "");
    expect(prompt).not.toMatch(/acct-/);
  });

  it("propagates a thrown call so the caller can isolate the failure", async () => {
    const session = new MockStructuredSession([() => new Error("kaboom")]);
    await expect(enrichTransfers(session, [row], context, accounts)).rejects.toThrow("kaboom");
  });
});
