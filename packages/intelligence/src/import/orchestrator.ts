/**
 * The import orchestrator state machine. See `specs/IMPORT.md` for the pipeline
 * shape (phases, the two stateless model-call points, the headless contract).
 *
 * Resume, interrupt, and crash-recovery are one code path: all three leave
 * identical persisted state in `.capy/import/` and resume by re-running
 * idempotent enrichment over rows that still fail `needsEnrich`. The driver
 * never holds run state the artifacts don't — where the user lands on reopen is
 * a pure function of which files exist.
 */

import {
  groundImport,
  type GroundingResult,
  type ImportTransaction,
  type RowContext,
  type TransferContext,
} from "@capybudget/core";
import type { StructuredSession } from "../structured";
import type { BudgetDataProvider } from "./budget-data";
import {
  batchRows,
  enrichBatch,
  enrichTransfers,
  needsEnrich,
  needsTransferEnrich,
  ENRICH_CONCURRENCY,
} from "./categorize";
import type { TransferEnriched } from "./schemas";
import {
  PIPELINE_PHASES,
  type ImportEvent,
  type ImportEventHandler,
  type ImportErrorReason,
  type ImportPhase,
  type LogLevel,
  type NormalizeProgress,
  type TerminalLogEntry,
} from "./events";
import { normalizeCsv, normalizeImage } from "./normalize";
import { normalizeOfx } from "./ofx";
import { classifySource } from "../source-files";
import type { StagingStore } from "./staging-store";

export interface OrchestratorDeps {
  session: StructuredSession;
  staging: StagingStore;
  budget: BudgetDataProvider;
  onEvent: ImportEventHandler;
  /** Override the batch concurrency (tests use 1 for deterministic ordering). */
  concurrency?: number;
}

/**
 * The driver API Unit 3's hook calls. `start()` runs the full pipeline from
 * the source files; `enrich()` runs Categorizing only (the idempotent re-run,
 * over rows that still need it); `stop()` interrupts cleanly. All three are
 * safe to call against existing staging — resume is `start()` noticing rows
 * already exist, re-run is `enrich()` filtering by `needsEnrich`.
 */
export class ImportOrchestrator {
  private readonly deps: OrchestratorDeps;
  private phase: ImportPhase = "idle";
  private stopRequested = false;
  private running = false;
  /** The in-flight run's promise, or null when idle. `stop()` awaits it so a
   *  caller can discard staging knowing no batch will write after the await. */
  private runPromise: Promise<void> | null = null;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  get currentPhase(): ImportPhase {
    return this.phase;
  }

  /**
   * Run the full pipeline. If `transactions.csv` already exists (a resume),
   * Reading/Normalizing/History are skipped and the run resumes at
   * Categorizing — the cheap phases are seconds of code, the expensive one is
   * the one worth resuming.
   */
  async start(): Promise<void> {
    return this.run(async () => {
      const existing = await this.deps.staging.readTransactions();
      if (existing) {
        // Resume: staging exists → pick up at Categorizing over the remainder.
        if (existing.dropped.length > 0) {
          this.log("warn", "categorizing", describeDroppedRows(existing.dropped));
        }
        this.log("info", "categorizing", `Resuming import — ${existing.rows.length} rows already staged.`);
        await this.runCategorizing(existing.rows);
        return;
      }
      await this.runFromScratch();
    });
  }

  /**
   * Categorizing only — the user-initiated re-run. Idempotent: processes just
   * the rows that still fail `needsEnrich`, so pressing Enrich on fully
   * enriched data is a no-op and after a partial run it finishes the remainder.
   */
  async enrich(): Promise<void> {
    return this.run(async () => {
      const staged = await this.deps.staging.readTransactions();
      if (!staged) {
        this.fail("internal", "No staged transactions to enrich.");
        return;
      }
      if (staged.dropped.length > 0) {
        this.log("warn", "categorizing", describeDroppedRows(staged.dropped));
      }
      await this.runCategorizing(staged.rows);
    });
  }

  /**
   * Request a clean stop and resolve once the in-flight batch has settled
   * (landed + persisted). No new batches dispatch; the in-flight one finishes
   * its write, so resume picks up from the persisted state — stop is a crash
   * you chose. Awaiting the returned promise is what lets a *cancel* safely
   * clear staging afterward: once it resolves, nothing will write again.
   */
  stop(): Promise<void> {
    this.stopRequested = true;
    return this.runPromise ?? Promise.resolve();
  }

  /** Shared run wrapper: serializes against a run already in flight, tracks the
   *  promise so `stop()` can await it, and funnels uncaught errors to `fail`. */
  private run(body: () => Promise<void>): Promise<void> {
    if (this.running) return this.runPromise ?? Promise.resolve();
    this.running = true;
    this.stopRequested = false;
    const promise = (async () => {
      try {
        await body();
      } catch (err) {
        this.fail("internal", err instanceof Error ? err.message : String(err));
      } finally {
        this.running = false;
        this.runPromise = null;
      }
    })();
    this.runPromise = promise;
    return promise;
  }

  // ── Pipeline ───────────────────────────────────────────────────

  private async runFromScratch(): Promise<void> {
    // Reading
    this.enterPhase("reading");
    const sources = await this.deps.staging.listSources();
    if (sources.length === 0) {
      this.fail("read", "No source files to import.", true);
      return;
    }
    this.log("info", "reading", `Read ${sources.length} file(s): ${sources.map((s) => s.name).join(", ")}.`);
    if (this.stopReturn()) return;

    // Normalizing — held in memory; staging isn't written until History has
    // grounded it, so "transactions.csv exists" always means normalized +
    // grounded. A crash before History leaves no staging → reopen lands on
    // file-attach, never on a half-baked preview.
    this.enterPhase("normalizing");
    const normalized = await this.normalize(sources);
    if (normalized === null) return; // no_data / stop already signaled
    this.log("info", "normalizing", `Normalized ${normalized.length} transactions.`);
    if (this.stopReturn()) return;

    // History — first staging write (transactions.csv + context.json together).
    this.enterPhase("history");
    const grounded = await this.runHistory(normalized);
    if (this.stopReturn()) return;

    // Categorizing
    await this.runCategorizing(grounded);
  }

  /**
   * Normalize all sources → one staged set with continuing ids. Returns null
   * only when *every* file yielded no transaction data (logged + routed to
   * file-attach). A single no_data file among several (a selfie dropped
   * alongside a real statement — the chat on-ramp can do this) is skipped with
   * a warning, not fatal. A stop is handled by the caller's terminal check
   * after this returns.
   */
  private async normalize(
    sources: Awaited<ReturnType<StagingStore["listSources"]>>,
  ): Promise<ImportTransaction[] | null> {
    // Existing account names ground the model's `sourceAccount` answers: an
    // exact-name answer resolves deterministically during History instead of
    // staging a near-miss the user has to map by hand.
    const existingAccounts = (await this.deps.budget.getAccounts())
      .filter((a) => !a.archived)
      .map((a) => a.name);
    const all: ImportTransaction[] = [];
    // The active file's progress, rebased onto the rows earlier files landed.
    // `total` covers only the files seen so far — it grows (and the consumer's
    // meter recalibrates) as each file reports its count.
    const fileProgress = (p: NormalizeProgress): void => {
      this.emit({
        type: "normalize-progress",
        progress: {
          rows: all.length + p.rows,
          total: p.total === null ? null : all.length + p.total,
        },
      });
    };
    for (const source of sources) {
      if (this.stopRequested) break;
      const startId = all.length + 1;
      const kind = classifySource(source.mediaType);
      if (kind === "image" || kind === "pdf") {
        this.status("normalizing", `Extracting transactions from ${source.name}…`);
        const result = await normalizeImage(this.deps.session, source, { startId, existingAccounts, onProgress: fileProgress });
        if (result.noData) {
          this.log("warn", "normalizing", `Skipped ${source.name} — no transaction data found.`);
          continue;
        }
        all.push(...result.rows);
      } else if (kind === "ofx") {
        // Deterministic — no model call. OFX fields are standardized, so the
        // rows are known the moment they parse; report progress in one shot.
        this.status("normalizing", `Reading transactions from ${source.name}…`);
        const result = normalizeOfx(source, { startId });
        if (result.dropped.length > 0) {
          this.log("warn", "normalizing", describeSkippedRows(source.name, result.dropped));
        }
        if (result.rows.length === 0) {
          this.log("warn", "normalizing", `Skipped ${source.name} — no transaction data found.`);
          continue;
        }
        fileProgress({ rows: result.rows.length, total: result.rows.length });
        all.push(...result.rows);
      } else {
        this.status("normalizing", `Mapping columns in ${source.name}…`);
        const result = await normalizeCsv(this.deps.session, source, { startId, existingAccounts, onProgress: fileProgress });
        if (result.errors.length > 0) {
          this.log("warn", "normalizing", describeSkippedRows(source.name, result.errors.map((e) => e.message)));
        }
        all.push(...result.rows);
      }
    }
    // All files empty (and not because we stopped early) → no_data terminal.
    if (all.length === 0 && !this.stopRequested) {
      await this.deps.staging.clear();
      this.fail("no_data", "No transaction data found in the uploaded file(s).", true);
      return null;
    }
    // Settle the meter on the actual landed count — per-file totals were
    // estimates (pre-skip-rule row counts, the model's declared count).
    if (all.length > 0) {
      this.emit({ type: "normalize-progress", progress: { rows: all.length, total: all.length } });
    }
    return all;
  }

  /** Deterministic grounding — match history, attach context, fast-path, dedup.
   *  Writes resolved fields back to staging + the context sidecar, then reports
   *  the payoff stats. */
  private async runHistory(rows: ImportTransaction[]): Promise<ImportTransaction[]> {
    this.status("history", "Matching against your history…");
    const [history, categories, accounts] = await Promise.all([
      this.deps.budget.getHistory(),
      this.deps.budget.getCategories(),
      this.deps.budget.getAccounts(),
    ]);

    // groundImport owns account resolution (name match + aliases) and writes the
    // result onto each row's `accountId` — no need to recompute the mapping here.
    const outcome = groundImport({ rows, history, accounts, categories });

    // Write the context sidecars *before* transactions.csv: resume gates on
    // transactions.csv existing, so this ordering makes "transactions.csv exists
    // ⟹ context exists" hold. A crash between writes then leaves no
    // transactions.csv → file-attach, never a Categorizing resume with empty
    // context (which would degrade AI categorization or counterpart-picking).
    const context: Record<string, RowContext> = {};
    for (const [id, ctx] of outcome.context) context[id] = ctx;
    await this.deps.staging.writeContext(context);

    const transferContext: Record<string, TransferContext> = {};
    for (const [id, ctx] of outcome.transferContext) transferContext[id] = ctx;
    await this.deps.staging.writeTransferContext(transferContext);

    const grounded = rows.map((row) => applyGrounding(row, outcome.results.get(row.id)));
    await this.deps.staging.writeTransactions(grounded);

    await this.deps.staging.writeState({
      phase: "history",
      rowCount: grounded.length,
      updatedAt: new Date().toISOString(),
    });
    this.emit({ type: "rows-changed" });

    const { total, resolved, duplicates } = outcome.stats;
    const message =
      `${resolved} of ${total} resolved from your history` +
      (duplicates > 0 ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"}` : "");
    this.emit({ type: "grounding", stats: { total, resolved, duplicates }, message });
    this.log("info", "history", message);

    return grounded;
  }

  /**
   * The model batch work. Two heterogeneous jobs share one bounded-parallel
   * worker pool: category batches enrich the rows that fail `needsEnrich`, and
   * transfer batches resolve the counterpart account for transfers that fail
   * `needsTransferEnrich`. Each landed batch is written back to staging
   * immediately (resume keeps landed batches). A batch that throws is logged and
   * skipped — its rows stay incomplete, no retry.
   */
  private async runCategorizing(rows: ImportTransaction[]): Promise<void> {
    this.enterPhase("categorizing");

    const [context, transferContext, categories, accounts] = await Promise.all([
      this.deps.staging.readContext().then((c) => c ?? {}),
      this.deps.staging.readTransferContext().then((c) => c ?? {}),
      this.deps.budget.getCategories().then((cats) => cats.filter((c) => !c.archived)),
      this.deps.budget.getAccounts().then((accts) => accts.filter((a) => !a.archived)),
    ]);

    const pendingCategory = rows.filter(needsEnrich);
    const pendingTransfer = rows.filter((r) => needsTransferEnrich(r, r.id in transferContext));
    const total = pendingCategory.length + pendingTransfer.length;
    if (total === 0) {
      this.log("info", "categorizing", "Nothing to categorize — all rows resolved.");
      this.finish();
      return;
    }

    // `byId` is the authoritative in-memory state for the run; staging is its
    // durable mirror. Landed batches mutate it synchronously (no await between
    // read and modify), and persistence is serialized through a tail-chained
    // promise — so concurrent batches can't lose each other's writes.
    const byId = new Map(rows.map((r) => [r.id, { ...r }]));

    // Heterogeneous job queue: category batches + (usually one) transfer batch,
    // drained by the same worker pool so transfers run alongside categories.
    type Job =
      | { kind: "category"; rows: ImportTransaction[] }
      | { kind: "transfer"; rows: ImportTransaction[] };
    const jobs: Job[] = [
      ...batchRows(pendingCategory).map((b): Job => ({ kind: "category", rows: b })),
      ...batchRows(pendingTransfer).map((b): Job => ({ kind: "transfer", rows: b })),
    ];

    let done = 0;
    this.emit({ type: "batch-progress", progress: { done, total } });
    this.status("categorizing", `Categorizing ${done} of ${total}…`);

    let persistChain: Promise<void> = Promise.resolve();
    const persistSnapshot = (): Promise<void> => {
      const snapshot = [...byId.values()];
      persistChain = persistChain.then(() => this.deps.staging.writeTransactions(snapshot));
      return persistChain;
    };

    const concurrency = this.deps.concurrency ?? ENRICH_CONCURRENCY;
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      while (true) {
        if (this.stopRequested) return;
        const index = cursor++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        try {
          if (job.kind === "category") {
            const enriched = await enrichBatch(this.deps.session, job.rows, context, categories);
            applyEnrichmentInto(byId, enriched);
          } else {
            const enriched = await enrichTransfers(this.deps.session, job.rows, transferContext, accounts);
            applyTransferEnrichmentInto(byId, enriched);
          }
          await persistSnapshot();
          // `done` counts landed rows only — a failed batch leaves its rows
          // incomplete, so the meter must not advance for it.
          done += job.rows.length;
          this.emit({ type: "rows-changed" });
        } catch (err) {
          this.log(
            "warn",
            "categorizing",
            `${job.kind === "transfer" ? "Transfer batch" : `Batch ${index + 1}`} failed (${job.rows.length} rows left for re-run): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        this.emit({ type: "batch-progress", progress: { done, total } });
        this.status("categorizing", `Categorizing ${done} of ${total}…`);
      }
    };

    if (pendingTransfer.length > 0) {
      this.log("info", "categorizing", `Resolving ${pendingTransfer.length} transfer ${pendingTransfer.length === 1 ? "counterpart" : "counterparts"}…`);
    }

    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, runNext);
    await Promise.all(workers);
    await persistChain;

    await this.deps.staging.writeState({
      phase: "categorizing",
      rowCount: rows.length,
      updatedAt: new Date().toISOString(),
    });

    if (this.stopRequested) {
      this.log("info", "categorizing", "Stopped — landed batches kept; re-run Enrich to finish.");
    }
    this.finish();
  }

  // ── Event helpers ──────────────────────────────────────────────

  private enterPhase(phase: ImportPhase): void {
    this.phase = phase;
    this.emit({ type: "phase", phase });
  }

  private status(phase: ImportPhase, message: string): void {
    this.emit({ type: "status", phase, message });
  }

  private log(level: LogLevel, phase: ImportPhase, message: string): void {
    const entry: TerminalLogEntry = { ts: Date.now(), level, phase, message };
    this.emit({ type: "log", entry });
  }

  /** True when a stop was requested. On the way out it emits the terminal
   *  signal so an early-phase stop (Reading/Normalizing/History) doesn't leave
   *  the UI silent with `phase` stuck — `done` is the clean-stop terminal,
   *  symmetric with a Categorizing stop. */
  private stopReturn(): boolean {
    if (!this.stopRequested) return false;
    this.log("info", this.phase, "Stopped — re-run to continue from here.");
    this.finish();
    return true;
  }

  private finish(): void {
    this.phase = "done";
    this.emit({ type: "phase", phase: "done" });
    this.emit({ type: "done" });
  }

  private fail(reason: ImportErrorReason, message: string, recoverable = false): void {
    this.phase = "error";
    this.emit({ type: "phase", phase: "error" });
    this.log("error", "error", message);
    this.emit({ type: "error", reason, message, recoverable });
  }

  private emit(event: ImportEvent): void {
    this.deps.onEvent(event);
  }
}

/** Cap a per-row note list so a wholly broken file logs a line, not a wall. */
function truncateNotes(notes: string[]): string {
  const shown = notes.slice(0, 3);
  const more = notes.length > shown.length ? ` (+${notes.length - shown.length} more)` : "";
  return `${shown.join("; ")}${more}`;
}

/** Warn-log line for rows a normalizer couldn't parse (CSV transform errors,
 *  OFX field failures). Each message already carries its own row/txn context. */
function describeSkippedRows(name: string, messages: string[]): string {
  const noun = messages.length === 1 ? "row" : "rows";
  return `${messages.length} ${noun} skipped in ${name} — couldn't parse: ${truncateNotes(messages)}`;
}

/** Warn-log line for staged rows the resume read's validation dropped. */
function describeDroppedRows(dropped: string[]): string {
  const noun = dropped.length === 1 ? "row" : "rows";
  return `${dropped.length} staged ${noun} skipped — failed validation: ${truncateNotes(dropped)}`;
}

// ── Pure row transforms ──────────────────────────────────────────

/** Write grounding's resolved fields onto a staged row. `groundImport` already
 *  resolved the account, so `result.accountId` is authoritative. `type` and
 *  `targetAccountId` are set only by payment-leg recognition — a recognized
 *  row stages as a transfer with its counterpart prefilled, so it never needs
 *  the transfer-enrich call. */
function applyGrounding(
  row: ImportTransaction,
  result: GroundingResult | undefined,
): ImportTransaction {
  if (!result) return row;
  return {
    ...row,
    type: result.type ?? row.type,
    merchant: result.merchant || row.merchant,
    categoryId: result.categoryId || row.categoryId,
    categoryConfidence: result.categoryConfidence || row.categoryConfidence,
    accountId: result.accountId || row.accountId,
    targetAccountId: result.targetAccountId || row.targetAccountId,
    duplicate: result.duplicate,
    duplicateConfidence: result.duplicateConfidence,
  };
}

/** Merge a landed batch's enrichment into the authoritative row map. Only fills
 *  empty fields, so a re-run never clobbers a hand-mapped or already-landed
 *  value — the idempotency the predicate promises holds at write time too. */
function applyEnrichmentInto(
  byId: Map<string, ImportTransaction>,
  enriched: { id: string; merchant: string; categoryId: string; confidence: "high" | "low" }[],
): void {
  for (const e of enriched) {
    const row = byId.get(e.id);
    if (!row) continue;
    byId.set(e.id, {
      ...row,
      merchant: row.merchant || e.merchant,
      categoryId: row.categoryId || e.categoryId,
      categoryConfidence: row.categoryId ? row.categoryConfidence : e.confidence,
    });
  }
}

/** Merge a landed transfer batch's counterpart picks into the row map. Only
 *  fills an empty `targetAccountId` (a model "" or unresolved name is already
 *  ""), so a re-run never clobbers a hand-set or already-landed counterpart —
 *  the same idempotency `applyEnrichmentInto` guarantees for categories. */
function applyTransferEnrichmentInto(
  byId: Map<string, ImportTransaction>,
  enriched: TransferEnriched[],
): void {
  for (const e of enriched) {
    if (!e.targetAccountId) continue;
    const row = byId.get(e.id);
    if (!row || row.targetAccountId) continue;
    byId.set(e.id, { ...row, targetAccountId: e.targetAccountId });
  }
}

/** The pipeline phases the section bar renders, re-exported for consumers. */
export { PIPELINE_PHASES };
