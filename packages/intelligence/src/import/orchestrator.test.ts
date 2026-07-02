import { describe, it, expect, vi } from "vitest";
import {
  makeAccount,
  makeCategory,
  makeImportTransaction,
  makeTransaction,
} from "@capybudget/core/test-factories";
import type { ImportTransaction } from "@capybudget/core";
import { ImportOrchestrator } from "./orchestrator";
import type { ImportEvent, ImportPhase } from "./events";
import { CSV_MAPPING_SCHEMA, ENRICH_BATCH_SCHEMA, EXTRACTION_SCHEMA } from "./schemas";
import {
  MemoryBudgetData,
  MemoryStagingStore,
  MockStructuredSession,
} from "./test-doubles";

// ── Fixtures ─────────────────────────────────────────────────────

const GROCERIES = makeCategory({ id: "cat-groceries", name: "Groceries" });
const DINING = makeCategory({ id: "cat-dining", name: "Dining Out" });
const CATEGORIES = [GROCERIES, DINING];

/** A budget data provider with categories + a history that fast-paths "WHOLE
 *  FOODS" (3 matching txns, all Groceries). */
function budgetWithHistory() {
  const history = [
    makeTransaction({ merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-groceries", datetime: "2026-01-01T00:00:00.000Z" }),
    makeTransaction({ merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-groceries", datetime: "2026-02-01T00:00:00.000Z" }),
    makeTransaction({ merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-groceries", datetime: "2026-03-01T00:00:00.000Z" }),
  ];
  return new MemoryBudgetData(history, CATEGORIES, [makeAccount({ name: "Checking" })]);
}

function emptyBudget() {
  return new MemoryBudgetData([], CATEGORIES, []);
}

/** Build a tiny CSV with N expense rows of distinct unknown merchants. */
function csvWithRows(count: number): string {
  const lines = ["Date,Description,Amount"];
  for (let i = 0; i < count; i++) {
    lines.push(`2026-01-${String((i % 28) + 1).padStart(2, "0")},MERCHANT ${i},-${10 + i}.00`);
  }
  return lines.join("\n");
}

function csvSource(content: string, name = "statement.csv") {
  return { name, content, mediaType: "text/csv" };
}

const MAPPING = {
  date: { column: "Date", format: "YYYY-MM-DD" },
  description: { column: "Description" },
  amount: { style: "single", column: "Amount", sign: "negative_expense" },
  amountFormat: { format: "plain" },
  typeDetection: { method: "amount_sign" },
  sourceAccount: { literal: "Checking" },
  sourceCategory: null,
};

/** Responder that returns the CSV mapping. */
const mapResponder = () => MAPPING;

/** Responder that enriches every row in the batch as Dining Out. The model
 *  returns a category *name* (`enrichBatch` maps it back to `cat-dining`). */
function enrichResponder(merchant = "Cleaned", category = "Dining Out") {
  return (messages: readonly { content: unknown }[]) => {
    const text = JSON.stringify(messages);
    const ids = [...new Set([...text.matchAll(/(imp-\d+)/g)].map((m) => m[1]))];
    return { rows: ids.map((id) => ({ id, merchant, category, confidence: "low" })) };
  };
}

function collect() {
  const events: ImportEvent[] = [];
  return { events, onEvent: (e: ImportEvent) => events.push(e) };
}

const phases = (events: ImportEvent[]): ImportPhase[] =>
  events.filter((e): e is { type: "phase"; phase: ImportPhase } => e.type === "phase").map((e) => e.phase);

// ── Phase progression ────────────────────────────────────────────

describe("ImportOrchestrator — phase progression", () => {
  it("runs Reading → Normalizing → History → Categorizing → done", async () => {
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(3))] });
    const session = new MockStructuredSession([mapResponder, enrichResponder()]);
    const { events, onEvent } = collect();

    const orch = new ImportOrchestrator({
      session,
      staging,
      budget: emptyBudget(),
      onEvent,
      concurrency: 1,
    });
    await orch.start();

    expect(phases(events)).toEqual([
      "reading",
      "normalizing",
      "history",
      "categorizing",
      "done",
    ]);
    expect(orch.currentPhase).toBe("done");
  });

  it("emits the grounding payoff line after History", async () => {
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(2))] });
    const session = new MockStructuredSession([mapResponder, enrichResponder()]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    const grounding = events.find((e) => e.type === "grounding");
    expect(grounding).toBeDefined();
    expect(grounding && grounding.type === "grounding" && grounding.stats.total).toBe(2);
  });

  it("passes the right schema to each model call", async () => {
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(1))] });
    const session = new MockStructuredSession([mapResponder, enrichResponder()]);

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).start();

    expect(session.calls[0].schema).toBe(CSV_MAPPING_SCHEMA);
    expect(session.calls[1].schema).toBe(ENRICH_BATCH_SCHEMA);
  });

  it("emits normalize-progress per file, rebased on earlier files, settling on the landed count", async () => {
    // Two CSVs of 2 and 3 rows: each file reports its data-row count as it
    // parses (the second rebased onto the first's landed rows), and the phase
    // closes by settling the meter on the actual total.
    const staging = new MemoryStagingStore({
      sources: [csvSource(csvWithRows(2), "a.csv"), csvSource(csvWithRows(3), "b.csv")],
    });
    const session = new MockStructuredSession([mapResponder, mapResponder, enrichResponder()]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    const ticks = events
      .filter((e): e is { type: "normalize-progress"; progress: { rows: number; total: number | null } } => e.type === "normalize-progress")
      .map((e) => e.progress);
    expect(ticks).toEqual([
      { rows: 0, total: 2 },
      { rows: 2, total: 5 },
      { rows: 5, total: 5 },
    ]);
  });
});

// ── Fast-path / duplicate rows skip Categorizing ─────────────────

describe("ImportOrchestrator — rows that skip Categorizing", () => {
  it("fast-pathed rows never reach the classifier", async () => {
    // Two rows: one fast-paths off history (WHOLE FOODS), one is unknown.
    const csv = "Date,Description,Amount\n2026-01-10,WHOLE FOODS,-50.00\n2026-01-11,MYSTERY VENDOR,-12.00";
    const staging = new MemoryStagingStore({ sources: [csvSource(csv)] });
    const session = new MockStructuredSession([mapResponder, enrichResponder()]);

    await new ImportOrchestrator({ session, staging, budget: budgetWithHistory(), onEvent: () => {}, concurrency: 1 }).start();

    // Mapping call + exactly one enrich batch (only the mystery row needs it).
    expect(session.calls).toHaveLength(2);
    const enrichText = JSON.stringify(session.calls[1].messages);
    expect(enrichText).toContain("MYSTERY VENDOR");
    expect(enrichText).not.toContain("WHOLE FOODS");

    const rows = staging.transactions!;
    const wholeFoods = rows.find((r) => r.description === "WHOLE FOODS")!;
    expect(wholeFoods.categoryId).toBe("cat-groceries");
    expect(wholeFoods.categoryConfidence).toBe("high");
    expect(wholeFoods.merchant).toBe("Whole Foods");
  });

  it("stages a recognized card payment as a transfer with the counterpart prefilled — no model call", async () => {
    // Normalizing types the row as an expense (amount sign); History's
    // payment-leg recognition retypes it and fills the counterpart, so neither
    // the category batch nor the transfer batch runs — mapping is the only call.
    const csv = "Date,Description,Amount\n2026-03-01,APPLECARD GSBANK DES:PAYMENT ID:M1234,-500.00";
    const staging = new MemoryStagingStore({ sources: [csvSource(csv)] });
    const session = new MockStructuredSession([mapResponder]);
    const budget = new MemoryBudgetData([], CATEGORIES, [
      makeAccount({ id: "acct-checking", name: "Checking" }),
      makeAccount({ id: "acct-apple", name: "🍏 Apple Card", type: "credit_card" }),
    ]);

    await new ImportOrchestrator({ session, staging, budget, onEvent: () => {}, concurrency: 1 }).start();

    expect(session.calls).toHaveLength(1); // mapping only
    const row = staging.transactions![0];
    expect(row.type).toBe("transfer");
    expect(row.targetAccountId).toBe("acct-apple");
    expect(row.accountId).toBe("acct-checking");
    expect(row.merchant).toBe("");
    expect(row.categoryId).toBe("");
  });

  it("a transfer row never reaches the category classifier", async () => {
    // With no transfer context, the transfer also skips the counterpart call —
    // only the unknown expense reaches the (single, category) batch.
    const rows = [
      makeImportTransaction({ id: "imp-1", type: "transfer", description: "XFER" }),
      makeImportTransaction({ id: "imp-2", description: "UNKNOWN", merchant: "", categoryId: "" }),
    ];
    const staging = new MemoryStagingStore({ transactions: rows });
    const session = new MockStructuredSession([enrichResponder()]);

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(1);
    const text = JSON.stringify(session.calls[0].messages);
    expect(text).toContain("imp-2");
    expect(text).not.toContain("imp-1");
  });

  it("resolves a transfer counterpart in Categorizing when it has context", async () => {
    // A transfer with transfer-context but no counterpart yet → the transfer
    // call runs alongside the category batch and writes targetAccountId.
    const savings = makeAccount({ id: "acct-savings", name: "Ally Savings" });
    const rows = [
      makeImportTransaction({ id: "imp-1", type: "transfer", description: "ACH SAVINGS", amount: 50000, accountId: "acct-checking", targetAccountId: "" }),
      makeImportTransaction({ id: "imp-2", description: "UNKNOWN", merchant: "", categoryId: "" }),
    ];
    const staging = new MemoryStagingStore({
      transactions: rows,
      transferContext: {
        "imp-1": { recentTransfers: [{ account: "Ally Savings", amount: 50000 }], topAccounts: [{ account: "Ally Savings", count: 5 }] },
      },
    });
    // Category batch (imp-2) + transfer batch (imp-1). The transfer responder
    // picks Ally Savings by name; enrichResponder handles the category row.
    const transferResponder = () => ({ rows: [{ id: "imp-1", account: "Ally Savings", confidence: "high" as const }] });
    const session = new MockStructuredSession([enrichResponder(), transferResponder]);
    const budget = new MemoryBudgetData([], CATEGORIES, [makeAccount({ id: "acct-checking", name: "Checking" }), savings]);

    await new ImportOrchestrator({ session, staging, budget, onEvent: () => {}, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(2);
    expect(staging.transactions!.find((r) => r.id === "imp-1")!.targetAccountId).toBe("acct-savings");
  });

  it("a transfer without transfer context resolves no counterpart", async () => {
    const rows = [
      makeImportTransaction({ id: "imp-1", type: "transfer", description: "XFER", amount: 50000, accountId: "acct-checking", targetAccountId: "" }),
    ];
    const staging = new MemoryStagingStore({ transactions: rows }); // no transferContext
    const session = new MockStructuredSession([]); // no calls expected
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(0);
    expect(staging.transactions!.find((r) => r.id === "imp-1")!.targetAccountId).toBe("");
    expect(phases(events)).toEqual(["categorizing", "done"]);
  });

  it("skips Categorizing entirely when nothing needs enrichment", async () => {
    const rows = [
      makeImportTransaction({ id: "imp-1", merchant: "Done", categoryId: "cat-groceries" }),
    ];
    const staging = new MemoryStagingStore({ transactions: rows });
    const session = new MockStructuredSession([]); // no calls expected
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(0);
    expect(phases(events)).toEqual(["categorizing", "done"]);
  });
});

// ── Batching + per-batch persistence ─────────────────────────────

describe("ImportOrchestrator — batching + per-batch persistence", () => {
  it("splits >25 rows into multiple batches and persists each as it lands", async () => {
    const rows: ImportTransaction[] = Array.from({ length: 60 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });
    // 60 rows / 25 = 3 batches.
    const session = new MockStructuredSession([enrichResponder(), enrichResponder(), enrichResponder()]);

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(3);
    // One write per landed batch (3), each writing back into staging.
    expect(staging.writeCount).toBe(3);
    expect(staging.transactions!.every((r) => r.categoryId === "cat-dining")).toBe(true);
  });

  it("does not lose writes when batches run concurrently", async () => {
    // 100 rows / 25 = 4 batches, run with the default concurrency of 4 (all at
    // once). Each batch enriches its own ids; a read-modify-write race would
    // drop some. Every row must land.
    const rows: ImportTransaction[] = Array.from({ length: 100 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });
    const session = new MockStructuredSession(
      Array.from({ length: 4 }, () => enrichResponder()),
    );

    // Concurrency 4 (the default) — omit the override.
    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {} }).enrich();

    expect(staging.transactions!.filter((r) => r.categoryId === "cat-dining")).toHaveLength(100);
  });

  it("emits batch-progress over the remaining incomplete rows", async () => {
    const rows: ImportTransaction[] = Array.from({ length: 30 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });
    const session = new MockStructuredSession([enrichResponder(), enrichResponder()]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).enrich();

    const progress = events.filter((e) => e.type === "batch-progress");
    const last = progress[progress.length - 1];
    expect(last.type === "batch-progress" && last.progress).toEqual({ done: 30, total: 30 });
  });
});

// ── no_data ──────────────────────────────────────────────────────

describe("ImportOrchestrator — no_data", () => {
  it("routes a no_data image to a recoverable error and writes no staging", async () => {
    const staging = new MemoryStagingStore({
      sources: [{ name: "selfie.png", content: "BASE64", mediaType: "image/png" }],
    });
    const session = new MockStructuredSession([
      () => ({ result: { error: "no_data", message: "This looks like a photo of a person." } }),
    ]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    const error = events.find((e) => e.type === "error");
    expect(error && error.type === "error" && error.reason).toBe("no_data");
    expect(error && error.type === "error" && error.recoverable).toBe(true);
    expect(staging.transactions).toBeNull();
    expect(session.calls[0].schema).toBe(EXTRACTION_SCHEMA);
  });

  it("treats an empty extraction as no_data", async () => {
    const staging = new MemoryStagingStore({
      sources: [{ name: "blank.png", content: "BASE64", mediaType: "image/png" }],
    });
    const session = new MockStructuredSession([() => ({ result: { count: 0, rows: [] } })]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    expect(events.find((e) => e.type === "error" && e.reason === "no_data")).toBeDefined();
    expect(staging.transactions).toBeNull();
  });

  it("extracts rows from a real bank screenshot like a CSV", async () => {
    const staging = new MemoryStagingStore({
      sources: [{ name: "bank.png", content: "BASE64", mediaType: "image/png" }],
    });
    const session = new MockStructuredSession([
      () => ({
        result: {
          count: 2,
          rows: [
            { date: "2026-01-05", amount: -1599, type: "expense", description: "Netflix", sourceAccount: "Checking", sourceCategory: "" },
            { date: "2026-01-06", amount: -4200, type: "expense", description: "Shell", sourceAccount: "Checking", sourceCategory: "" },
          ],
        },
      }),
      enrichResponder(),
    ]);

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).start();

    expect(staging.transactions).toHaveLength(2);
    expect(staging.transactions![0].id).toBe("imp-1");
    expect(staging.transactions![0].description).toBe("Netflix");
  });

  it("skips a no_data file among several and imports the rest", async () => {
    // A selfie dropped alongside a real CSV — the bad file is warned + skipped,
    // the good file still imports (not all-or-nothing).
    const staging = new MemoryStagingStore({
      sources: [
        { name: "selfie.png", content: "B64", mediaType: "image/png" },
        csvSource(csvWithRows(2)),
      ],
    });
    const session = new MockStructuredSession([
      () => ({ result: { error: "no_data", message: "Just a selfie." } }),
      mapResponder,
      enrichResponder(),
    ]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(staging.transactions).toHaveLength(2);
    const warn = events.find((e) => e.type === "log" && e.entry.level === "warn");
    expect(warn && warn.type === "log" && warn.entry.message).toContain("selfie.png");
    // Ids continue from 1 — the skipped file consumed none.
    expect(staging.transactions![0].id).toBe("imp-1");
  });
});

// ── CSV transform errors surface as warnings ─────────────────────

describe("ImportOrchestrator — CSV transform errors", () => {
  it("warns about rows the transform couldn't parse instead of dropping them silently", async () => {
    // Row 2's date is unparseable — it errors in the final transform. The run
    // still imports the good row, but the user gets a warn-log line.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\nNOTADATE,BROKEN,-1.00";
    const staging = new MemoryStagingStore({ sources: [csvSource(csv)] });
    // Two mapping calls (the bad row trips the preview re-call) + one enrich batch.
    const session = new MockStructuredSession([mapResponder, mapResponder, enrichResponder()]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    expect(staging.transactions).toHaveLength(1); // only the good row staged
    const warn = events.find((e) => e.type === "log" && e.entry.level === "warn");
    expect(warn && warn.type === "log" && warn.entry.phase).toBe("normalizing");
    expect(warn && warn.type === "log" && warn.entry.message).toContain("skipped");
    expect(warn && warn.type === "log" && warn.entry.message).toContain("NOTADATE");
  });
});

// ── Crash-safe write order: context before transactions ──────────

describe("ImportOrchestrator — History write order", () => {
  it("writes both context sidecars before transactions.csv so the resume gate stays correct", async () => {
    // Resume gates on transactions.csv existing; writing it last guarantees
    // "transactions.csv exists ⟹ context exists" — no Categorizing resume with
    // empty context (history or transfer) after a crash mid-History.
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(3))] });
    const session = new MockStructuredSession([mapResponder, enrichResponder()]);
    const ctxSpy = vi.spyOn(staging, "writeContext");
    const transferCtxSpy = vi.spyOn(staging, "writeTransferContext");
    const txnSpy = vi.spyOn(staging, "writeTransactions");

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).start();

    expect(ctxSpy).toHaveBeenCalled();
    expect(transferCtxSpy).toHaveBeenCalled();
    expect(txnSpy).toHaveBeenCalled();
    expect(ctxSpy.mock.invocationCallOrder[0]).toBeLessThan(txnSpy.mock.invocationCallOrder[0]);
    expect(transferCtxSpy.mock.invocationCallOrder[0]).toBeLessThan(txnSpy.mock.invocationCallOrder[0]);
  });
});

// ── Batch-failure isolation (no retry) ───────────────────────────

describe("ImportOrchestrator — batch-failure isolation", () => {
  it("a failed batch leaves its rows incomplete and never retries", async () => {
    const rows: ImportTransaction[] = Array.from({ length: 50 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });
    // Batch 1 throws, batch 2 succeeds. No retry → exactly 2 calls.
    const session = new MockStructuredSession([
      () => new Error("rate limited"),
      enrichResponder(),
    ]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(2); // no retry of the failed batch
    const warn = events.find((e) => e.type === "log" && e.entry.level === "warn");
    expect(warn).toBeDefined();

    // Batch 1's rows (imp-1..25) stay uncategorized; batch 2's are done.
    const stillPending = staging.transactions!.filter((r) => !r.categoryId);
    expect(stillPending).toHaveLength(25);
    expect(staging.transactions!.filter((r) => r.categoryId === "cat-dining")).toHaveLength(25);
    // The run still completes — failure isn't fatal.
    const seen = phases(events);
    expect(seen[seen.length - 1]).toBe("done");
  });
});

// ── Re-run idempotency + resume ──────────────────────────────────

describe("ImportOrchestrator — re-run idempotency + resume", () => {
  it("re-running enrich only processes rows that still need it", async () => {
    // 25 done + 25 pending = one batch of work on re-run.
    const done = Array.from({ length: 25 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, merchant: "X", categoryId: "cat-dining" }),
    );
    const pending = Array.from({ length: 25 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 26}`, description: `P${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: [...done, ...pending] });
    const session = new MockStructuredSession([enrichResponder()]);

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(1); // only the 25 pending rows
    expect(staging.transactions!.every((r) => r.categoryId)).toBe(true);
  });

  it("re-run never clobbers a hand-mapped value", async () => {
    const hand = makeImportTransaction({ id: "imp-1", merchant: "Hand Mapped", categoryId: "cat-groceries", categoryConfidence: "high" });
    const staging = new MemoryStagingStore({ transactions: [hand] });
    const session = new MockStructuredSession([]); // hand row fails predicate → no call

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent: () => {}, concurrency: 1 }).enrich();

    expect(session.calls).toHaveLength(0);
    expect(staging.transactions![0].merchant).toBe("Hand Mapped");
    expect(staging.transactions![0].categoryId).toBe("cat-groceries");
  });

  it("a second full run resumes at Categorizing when staging already exists", async () => {
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(3))] });
    const firstSession = new MockStructuredSession([mapResponder, enrichResponder()]);
    const { events: firstEvents, onEvent: onFirst } = collect();
    await new ImportOrchestrator({ session: firstSession, staging, budget: emptyBudget(), onEvent: onFirst, concurrency: 1 }).start();
    expect(phases(firstEvents)).toContain("normalizing");

    // Rows are now fully enriched; a fresh start() resumes and re-categorizes
    // only what still needs it (nothing) — no Normalizing, no mapping call.
    const secondSession = new MockStructuredSession([]);
    const { events: secondEvents, onEvent: onSecond } = collect();
    await new ImportOrchestrator({ session: secondSession, staging, budget: emptyBudget(), onEvent: onSecond, concurrency: 1 }).start();

    expect(phases(secondEvents)).not.toContain("normalizing");
    expect(phases(secondEvents)).toContain("categorizing");
    expect(secondSession.calls).toHaveLength(0);
  });

  it("a resume warns about rows the staging read dropped — sampling drops only, never fixes", async () => {
    const staging = new MemoryStagingStore({
      transactions: [
        makeImportTransaction({ id: "", description: "NO ID" }), // fixable: id backfilled, row kept
        ...Array.from({ length: 5 }, (_, i) =>
          makeImportTransaction({ id: `imp-${i + 1}`, date: "Pending" }),
        ),
        makeImportTransaction({ id: "imp-9", description: "SURVIVOR" }),
      ],
    });
    const session = new MockStructuredSession([enrichResponder()]);
    const { events, onEvent } = collect();

    await new ImportOrchestrator({ session, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    const logs = events.flatMap((e) => (e.type === "log" ? [e.entry] : []));
    const warn = logs.find((l) => l.level === "warn");
    expect(warn).toBeDefined();
    expect(warn!.message).toContain("5 staged rows skipped — failed validation");
    expect(warn!.message).toContain('invalid date "Pending"');
    expect(warn!.message).toContain("(+2 more)"); // detail capped at 3 samples
    expect(warn!.message).not.toContain("missing id"); // the fix isn't a drop
    // The run resumes over the survivors: the fixed row + the intact one.
    const resume = logs.find((l) => l.message.startsWith("Resuming import"));
    expect(resume!.message).toContain("2 rows already staged");
  });
});

// ── Duplicate persistence ────────────────────────────────────────

describe("ImportOrchestrator — duplicate persistence", () => {
  /** A budget whose history contains the exact row being imported (same date +
   *  amount + account), but the historical txn is uncategorized. */
  function budgetWithUncategorizedDup() {
    const history = [
      makeTransaction({
        datetime: "2026-01-10T00:00:00.000Z",
        amount: -2599,
        categoryId: "", // uncategorized historical txn
        merchant: "",
        note: "ACME STORE",
        accountId: "acc-checking",
      }),
    ];
    const accounts = [makeAccount({ id: "acc-checking", name: "Checking" })];
    return new MemoryBudgetData(history, CATEGORIES, accounts);
  }

  it("persists the duplicate flag and keeps a dup of an uncategorized txn out of the classifier", async () => {
    const csv = "Date,Description,Amount\n2026-01-10,ACME STORE,-25.99";
    const staging = new MemoryStagingStore({ sources: [csvSource(csv)] });
    const session = new MockStructuredSession([mapResponder]); // no enrich call expected

    await new ImportOrchestrator({
      session,
      staging,
      budget: budgetWithUncategorizedDup(),
      onEvent: () => {},
      concurrency: 1,
    }).start();

    const row = staging.transactions![0];
    expect(row.duplicate).toBe(true);
    expect(row.duplicateConfidence).toBe("high"); // exact date + description + account
    // Dup with no carried category must still skip enrichment (the !duplicate term).
    expect(session.calls).toHaveLength(1); // mapping only — no enrich batch
    // Survives a serialize → parse round-trip (resume sees it).
    const reread = await staging.readTransactions();
    expect(reread!.rows[0].duplicate).toBe(true);
    expect(reread!.rows[0].duplicateConfidence).toBe("high");
  });
});

// ── Resume contract: staging means normalized + grounded ─────────

describe("ImportOrchestrator — resume contract", () => {
  it("does not write transactions.csv until History has grounded it", async () => {
    // Stop fires during the mapping call (Normalizing). The run must end before
    // History writes staging — so reopen lands on file-attach, not a half-baked
    // ungrounded preview.
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(3))] });
    const orch = new ImportOrchestrator({
      session: new MockStructuredSession([
        () => {
          orch.stop();
          return MAPPING;
        },
      ]),
      staging,
      budget: emptyBudget(),
      onEvent: () => {},
      concurrency: 1,
    });

    await orch.start();

    expect(staging.transactions).toBeNull(); // never written
    expect(staging.context).toBeNull();
  });

  it("a fresh start() after a Normalizing-stop re-runs the full pipeline", async () => {
    // No staging was written by the interrupted run, so start() begins from
    // Reading again — Normalizing runs, History grounds, Categorizing finishes.
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(2))] });
    const firstOrch = new ImportOrchestrator({
      session: new MockStructuredSession([
        () => {
          firstOrch.stop();
          return MAPPING;
        },
      ]),
      staging,
      budget: emptyBudget(),
      onEvent: () => {},
      concurrency: 1,
    });
    await firstOrch.start();
    expect(staging.transactions).toBeNull();

    const second = new MockStructuredSession([mapResponder, enrichResponder()]);
    const { events, onEvent } = collect();
    await new ImportOrchestrator({ session: second, staging, budget: emptyBudget(), onEvent, concurrency: 1 }).start();

    expect(phases(events)).toEqual(["reading", "normalizing", "history", "categorizing", "done"]);
    expect(staging.transactions).toHaveLength(2);
  });
});

// ── Stop ─────────────────────────────────────────────────────────

describe("ImportOrchestrator — stop", () => {
  it("emits a terminal done when stopped during an early phase", async () => {
    const staging = new MemoryStagingStore({ sources: [csvSource(csvWithRows(2))] });
    const { events, onEvent } = collect();
    const orch = new ImportOrchestrator({
      session: new MockStructuredSession([
        () => {
          orch.stop();
          return MAPPING;
        },
      ]),
      staging,
      budget: emptyBudget(),
      onEvent,
      concurrency: 1,
    });

    await orch.start();

    // The run reaches a terminal state instead of going silent.
    expect(events.some((e) => e.type === "done")).toBe(true);
    const seen = phases(events);
    expect(seen[seen.length - 1]).toBe("done");
    expect(orch.currentPhase).toBe("done");
  });

  it("stop() resolves only after the in-flight batch has landed + persisted", async () => {
    // The cancel race: a caller awaits stop() then clears staging. stop() must
    // not resolve until the in-flight batch's write is done — otherwise the
    // batch lands after the clear and resurrects the discarded import.
    const rows: ImportTransaction[] = Array.from({ length: 50 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });

    // Gate the first batch's model call so the batch is genuinely *in flight*
    // (dispatched, not yet landed) when stop() fires. `batchStarted` resolves
    // once the call is entered; `batchGate` holds it open until we release.
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((res) => { releaseBatch = res; });
    let markStarted!: () => void;
    const batchStarted = new Promise<void>((res) => { markStarted = res; });
    let writeAfterStop = false;
    let stopResolved = false;

    const orch = new ImportOrchestrator({
      session: new MockStructuredSession([
        async (messages: readonly { content: unknown }[]) => {
          markStarted();
          await batchGate;
          const text = JSON.stringify(messages);
          const ids = [...new Set([...text.matchAll(/(imp-\d+)/g)].map((m) => m[1]))];
          return { rows: ids.map((id) => ({ id, merchant: "C", category: "Dining Out", confidence: "low" })) };
        },
      ]),
      staging,
      budget: emptyBudget(),
      // Observe a write that happens after stop() resolved — there must be none.
      onEvent: (e) => { if (e.type === "rows-changed" && stopResolved) writeAfterStop = true; },
      concurrency: 1,
    });

    const runPromise = orch.enrich();
    // Wait until the first batch's model call is actually dispatched.
    await batchStarted;
    const stopPromise = orch.stop().then(() => { stopResolved = true; });

    // stop() is still pending — the in-flight batch hasn't landed yet.
    releaseBatch();
    await stopPromise;
    await runPromise;

    // The in-flight batch landed (its write is part of the run stop() awaited).
    expect(staging.transactions!.filter((r) => r.categoryId === "cat-dining")).toHaveLength(25);
    // No rows-changed fired after stop() resolved — the run is fully quiescent.
    expect(writeAfterStop).toBe(false);
    expect(orch.currentPhase).toBe("done");
  });

  it("stops dispatching new batches but lets the in-flight one land", async () => {
    const rows: ImportTransaction[] = Array.from({ length: 75 }, (_, i) =>
      makeImportTransaction({ id: `imp-${i + 1}`, description: `V${i}` }),
    );
    const staging = new MemoryStagingStore({ transactions: rows });
    let calls = 0;
    const orch = new ImportOrchestrator({
      session: new MockStructuredSession(
        Array.from({ length: 3 }, () => (messages: readonly { content: unknown }[]) => {
          calls++;
          if (calls === 1) orch.stop(); // stop after the first batch is in-flight
          const text = JSON.stringify(messages);
          const ids = [...new Set([...text.matchAll(/(imp-\d+)/g)].map((m) => m[1]))];
          return { rows: ids.map((id) => ({ id, merchant: "C", category: "Dining Out", confidence: "low" })) };
        }),
      ),
      staging,
      budget: emptyBudget(),
      onEvent: () => {},
      concurrency: 1,
    });

    await orch.enrich();

    // The first batch landed (25 rows); no further batches dispatched.
    expect(calls).toBe(1);
    expect(staging.transactions!.filter((r) => r.categoryId === "cat-dining")).toHaveLength(25);
    expect(orch.currentPhase).toBe("done");
  });
});
