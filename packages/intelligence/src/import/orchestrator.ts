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
import { deadEndKind, extractErrorMessage, isDeadEnd } from "../error-message";
import { CutOffError, RefusedError, SchemaValidationError, type StructuredSession } from "../structured";
import type { SessionProvider } from "../types";
import type { BudgetDataProvider } from "./budget-data";
import {
  batchRows,
  enrichBatch,
  enrichTransfers,
  needsEnrich,
  needsTransferEnrich,
  ENRICH_BATCH_SIZE,
  ENRICH_CONCURRENCY,
  OLLAMA_ENRICH_BATCH_SIZE,
} from "./categorize";
import type { EnrichedRow, TransferEnriched } from "./schemas";
import {
  PIPELINE_PHASES,
  type BatchFailureCause,
  type FileFailureCause,
  type ImportEvent,
  type ImportEventHandler,
  type ImportFailure,
  type ImportLogNotice,
  type ImportPhase,
  type ImportStatus,
  type LogLevel,
  type NormalizeProgress,
  type Sample,
  type TerminalLogEntry,
} from "./events";
import { normalizeCsv, normalizeImage } from "./normalize";
import { normalizeOfx } from "./ofx";
import { classifySource } from "../source-files";
import type { SourceFile, StagingStore } from "./staging-store";

export interface OrchestratorDeps {
  session: StructuredSession;
  staging: StagingStore;
  budget: BudgetDataProvider;
  onEvent: ImportEventHandler;
  /** Override the batch concurrency (tests use 1 for deterministic ordering). */
  concurrency?: number;
  provider?: SessionProvider;
  /** Defaults to true. A PDF the provider can't read is skipped with a warning. */
  pdfSupported?: boolean;
  /** Whether the model reads images — null when that can't be determined.
   *  Asked once, on the first image source. Omitted means it does. */
  imageSupport?: (signal: AbortSignal) => Promise<boolean | null>;
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
  private controller = new AbortController();
  private imageSupport: Promise<boolean | null> | null = null;
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
          this.log("warn", "categorizing", { code: "categorize.droppedRows", params: { sample: sample(existing.dropped) } });
        }
        this.log("info", "categorizing", { code: "categorize.resuming", params: { count: existing.rows.length } });
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
        this.fail({ code: "enrich.noStaging" });
        return;
      }
      if (staged.dropped.length > 0) {
        this.log("warn", "categorizing", { code: "categorize.droppedRows", params: { sample: sample(staged.dropped) } });
      }
      await this.runCategorizing(staged.rows);
    });
  }

  /**
   * Request a clean stop and resolve once the run has settled. A model call in
   * Reading/Normalizing is aborted — nothing is staged yet, so its result would
   * be thrown away. In Categorizing no new batches dispatch and the in-flight
   * one finishes its write, so resume picks up from the persisted state — stop
   * is a crash you chose.
   */
  stop(): Promise<void> {
    this.stopRequested = true;
    if (this.phase === "reading" || this.phase === "normalizing") this.controller.abort();
    return this.runPromise ?? Promise.resolve();
  }

  /** Stop and abort whatever model call is in flight, in any phase. Once the
   *  returned promise resolves nothing will write again, so the caller can
   *  discard staging. */
  cancel(): Promise<void> {
    this.stopRequested = true;
    this.controller.abort();
    return this.runPromise ?? Promise.resolve();
  }

  private get aborted(): boolean {
    return this.controller.signal.aborted;
  }

  /** Shared run wrapper: serializes against a run already in flight, tracks the
   *  promise so `stop()` can await it, and funnels uncaught errors to `fail`. */
  private run(body: () => Promise<void>): Promise<void> {
    if (this.running) return this.runPromise ?? Promise.resolve();
    this.running = true;
    this.stopRequested = false;
    this.controller = new AbortController();
    const promise = (async () => {
      try {
        await body();
      } catch (err) {
        if (this.aborted) this.stopReturn();
        else this.failWith(err);
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
      this.fail({ code: "read.noSources" }, { recoverable: true });
      return;
    }
    this.log("info", "reading", { code: "reading.files", params: { files: sources.map((s) => s.name) } });
    if (this.stopReturn()) return;

    // Normalizing — held in memory; staging isn't written until History has
    // grounded it, so "transactions.csv exists" always means normalized +
    // grounded (an empty set included — zero rows is a valid grounded outcome
    // that lands on an empty preview). A crash before History leaves no staging
    // → reopen lands on file-attach, never on a half-baked preview.
    this.enterPhase("normalizing");
    const normalized = await this.normalize(sources);
    if (!normalized) return;
    this.log("info", "normalizing", { code: "normalize.done", params: { count: normalized.length } });
    if (this.stopReturn()) return;

    // History — first staging write (transactions.csv + context.json together).
    this.enterPhase("history");
    const grounded = await this.runHistory(normalized);
    if (this.stopReturn()) return;

    // Categorizing
    await this.runCategorizing(grounded);
  }

  /**
   * Normalize all sources → one staged set with continuing ids. A no-data or
   * failed file is skipped with a warning; null only when no file yielded a
   * row and one failed. A dead end or an abort throws.
   */
  private async normalize(sources: SourceFile[]): Promise<ImportTransaction[] | null> {
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
    let failure: { file: string; cause: FileFailureCause } | null = null;
    for (const source of sources) {
      if (this.stopRequested) break;
      try {
        all.push(...(await this.normalizeSource(source, all.length + 1, existingAccounts, fileProgress)));
      } catch (err) {
        if (this.aborted || isDeadEnd(err)) throw err;
        failure = { file: source.name, cause: fileFailureCause(err) };
        this.log("warn", "normalizing", { code: "normalize.fileSkipped", params: failure });
      }
    }
    if (all.length === 0 && failure) {
      this.fail({ code: "normalize.fileFailed", params: failure });
      return null;
    }
    // Settle the meter on the actual landed count — per-file totals were
    // estimates (pre-skip-rule row counts, the model's declared count). An empty
    // result stays at zero and lands History → empty preview, not an error.
    if (all.length > 0) {
      this.emit({ type: "normalize-progress", progress: { rows: all.length, total: all.length } });
    }
    return all;
  }

  private async assertReadsImages(): Promise<void> {
    if (!this.deps.imageSupport) return;
    const firstAsk = this.imageSupport === null;
    this.imageSupport ??= this.deps.imageSupport(this.controller.signal);
    const supported = await this.imageSupport;
    if (supported === false) throw new UnreadableSourceError("noVision");
    if (supported === null && firstAsk) {
      this.log("warn", "normalizing", { code: "normalize.visionUnknown" });
    }
  }

  /** One source file → staged rows (empty for a no-data file). Throws when the
   *  file can't be read; the caller skips it. */
  private async normalizeSource(
    source: SourceFile,
    startId: number,
    existingAccounts: string[],
    onProgress: (p: NormalizeProgress) => void,
  ): Promise<ImportTransaction[]> {
    const { signal } = this.controller;
    const kind = classifySource(source.mediaType);
    if (kind === "pdf" && this.deps.pdfSupported === false) {
      throw new UnreadableSourceError("pdfUnsupported");
    }
    if (kind === "image") await this.assertReadsImages();
    if (kind === "image" || kind === "pdf") {
      this.status("normalizing", { code: "normalize.extracting", params: { file: source.name } });
      const result = await normalizeImage(this.deps.session, source, { startId, existingAccounts, onProgress, signal });
      for (const warning of result.warnings) this.log("warn", "normalizing", warning);
      if (result.noData) {
        this.log("warn", "normalizing", { code: "normalize.noData", params: { file: source.name } });
        return [];
      }
      return result.rows;
    }
    if (kind === "ofx") {
      // Deterministic — no model call. OFX fields are standardized, so the
      // rows are known the moment they parse; report progress in one shot.
      this.status("normalizing", { code: "normalize.readingOfx", params: { file: source.name } });
      const result = normalizeOfx(source, { startId });
      if (result.dropped.length > 0) {
        this.log("warn", "normalizing", { code: "normalize.rowsUnparsed", params: { file: source.name, sample: sample(result.dropped) } });
      }
      if (result.rows.length === 0) {
        this.log("warn", "normalizing", { code: "normalize.noData", params: { file: source.name } });
        return [];
      }
      onProgress({ rows: result.rows.length, total: result.rows.length });
      return result.rows;
    }
    this.status("normalizing", { code: "normalize.mappingColumns", params: { file: source.name } });
    const result = await normalizeCsv(this.deps.session, source, { startId, existingAccounts, onProgress, signal });
    if (result.errors.length > 0) {
      this.log("warn", "normalizing", {
        code: "normalize.rowsUnparsed",
        params: { file: source.name, sample: sample(result.errors.map((e) => e.message)) },
      });
    }
    for (const warning of result.warnings) this.log("warn", "normalizing", warning);
    return result.rows;
  }

  /** Deterministic grounding — match history, attach context, fast-path, dedup.
   *  Writes resolved fields back to staging + the context sidecar, then reports
   *  the payoff stats. */
  private async runHistory(rows: ImportTransaction[]): Promise<ImportTransaction[]> {
    this.status("history", { code: "history.matching" });
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
    const stats = { total, resolved, duplicates };
    this.emit({ type: "grounding", stats });
    this.log("info", "history", { code: "history.payoff", params: stats });

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
      this.log("info", "categorizing", { code: "categorize.nothingToDo" });
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
    const batchSize = this.deps.provider === "ollama" ? OLLAMA_ENRICH_BATCH_SIZE : ENRICH_BATCH_SIZE;
    const jobs: Job[] = [
      ...batchRows(pendingCategory, batchSize).map((b): Job => ({ kind: "category", rows: b })),
      ...batchRows(pendingTransfer, batchSize).map((b): Job => ({ kind: "transfer", rows: b })),
    ];

    let done = 0;
    this.emit({ type: "batch-progress", progress: { done, total } });
    this.status("categorizing", { code: "categorize.progress", params: { done, total } });

    let persistChain: Promise<void> = Promise.resolve();
    const persistSnapshot = (): Promise<void> => {
      const snapshot = [...byId.values()];
      persistChain = persistChain.then(() => this.deps.staging.writeTransactions(snapshot));
      return persistChain;
    };

    const concurrency = this.deps.concurrency ?? ENRICH_CONCURRENCY;
    const { signal } = this.controller;
    let cursor = 0;
    let deadEnd: unknown = null;
    let lastFailure: BatchFailureCause | null = null;

    const runNext = async (): Promise<void> => {
      while (true) {
        if (this.stopRequested || deadEnd !== null) return;
        const index = cursor++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        try {
          const landed =
            job.kind === "category"
              ? applyEnrichmentInto(byId, await enrichBatch(this.deps.session, job.rows, context, categories, signal))
              : applyTransferEnrichmentInto(byId, await enrichTransfers(this.deps.session, job.rows, transferContext, accounts, signal));
          await persistSnapshot();
          done += landed;
          this.emit({ type: "rows-changed" });
        } catch (err) {
          if (this.aborted) return;
          if (isDeadEnd(err)) {
            deadEnd ??= err;
            return;
          }
          const cause = batchFailureCause(err);
          lastFailure = cause;
          const count = job.rows.length;
          this.log(
            "warn",
            "categorizing",
            job.kind === "transfer"
              ? { code: "categorize.transferBatchFailed", params: { count, cause } }
              : { code: "categorize.batchFailed", params: { batch: index + 1, count, cause } },
          );
        }
        this.emit({ type: "batch-progress", progress: { done, total } });
        this.status("categorizing", { code: "categorize.progress", params: { done, total } });
      }
    };

    if (pendingTransfer.length > 0) {
      this.log("info", "categorizing", { code: "categorize.transfers", params: { count: pendingTransfer.length } });
    }

    const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, runNext);
    await Promise.all(workers);
    await persistChain;

    await this.deps.staging.writeState({
      phase: "categorizing",
      rowCount: rows.length,
      updatedAt: new Date().toISOString(),
    });

    if (deadEnd !== null) {
      this.failWith(deadEnd);
      return;
    }
    if (this.stopRequested) {
      this.log("info", "categorizing", { code: "categorize.stopped" });
    } else if (done === 0) {
      this.fail({ code: "categorize.noneLanded", params: { count: total, cause: lastFailure } });
      return;
    }
    this.finish();
  }

  // ── Event helpers ──────────────────────────────────────────────

  private enterPhase(phase: ImportPhase): void {
    this.phase = phase;
    this.emit({ type: "phase", phase });
  }

  private status(phase: ImportPhase, notice: ImportStatus): void {
    this.emit({ type: "status", phase, notice });
  }

  private log(level: LogLevel, phase: ImportPhase, notice: ImportLogNotice): void {
    const entry: TerminalLogEntry = { ts: Date.now(), level, phase, notice };
    this.emit({ type: "log", entry });
  }

  /** True when a stop was requested. On the way out it emits the terminal
   *  signal so an early-phase stop (Reading/Normalizing/History) doesn't leave
   *  the UI silent with `phase` stuck — `done` is the clean-stop terminal,
   *  symmetric with a Categorizing stop. */
  private stopReturn(): boolean {
    if (!this.stopRequested) return false;
    this.log("info", this.phase, { code: "stopped" });
    this.finish();
    return true;
  }

  private finish(): void {
    this.phase = "done";
    this.emit({ type: "phase", phase: "done" });
    this.emit({ type: "done" });
  }

  private failWith(err: unknown): void {
    const kind = deadEndKind(err);
    const { provider } = this.deps;
    this.fail(
      kind && provider
        ? { code: "deadEnd", params: { kind, provider } }
        : { code: "failed", params: { detail: extractErrorMessage(err).message } },
    );
  }

  private fail(notice: ImportFailure, { recoverable = false }: { recoverable?: boolean } = {}): void {
    this.phase = "error";
    this.emit({ type: "phase", phase: "error" });
    this.log("error", "error", notice);
    this.emit({ type: "error", notice, recoverable });
  }

  private emit(event: ImportEvent): void {
    this.deps.onEvent(event);
  }
}

class UnreadableSourceError extends Error {
  constructor(readonly kind: "pdfUnsupported" | "noVision") {
    super(kind);
    this.name = "UnreadableSourceError";
  }
}

function batchFailureCause(err: unknown): BatchFailureCause {
  if (err instanceof CutOffError) return { kind: "cutOff" };
  if (err instanceof RefusedError) return { kind: "refused" };
  if (err instanceof SchemaValidationError) return { kind: "unusable" };
  return { kind: "other", detail: extractErrorMessage(err).message };
}

function fileFailureCause(err: unknown): FileFailureCause {
  return err instanceof UnreadableSourceError ? { kind: err.kind } : batchFailureCause(err);
}

const SAMPLE_SIZE = 3;

/** Cap a per-row note list so a wholly broken file logs a line, not a wall. */
function sample(notes: string[]): Sample {
  const items = notes.slice(0, SAMPLE_SIZE);
  return { items, more: notes.length - items.length };
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
 *  value — the idempotency the predicate promises holds at write time too.
 *  Returns how many rows this resolved (they no longer need enrichment). */
function applyEnrichmentInto(byId: Map<string, ImportTransaction>, enriched: EnrichedRow[]): number {
  let landed = 0;
  for (const e of enriched) {
    const row = byId.get(e.id);
    if (!row) continue;
    const categoryLanded = !row.categoryId && e.categoryId !== "";
    const next = {
      ...row,
      merchant: row.merchant || e.merchant,
      categoryId: row.categoryId || e.categoryId,
      categoryConfidence: categoryLanded ? e.confidence : row.categoryConfidence,
    };
    byId.set(e.id, next);
    if (needsEnrich(row) && !needsEnrich(next)) landed++;
  }
  return landed;
}

/** Merge a landed transfer batch's counterpart picks into the row map. Only
 *  fills an empty `targetAccountId` (a model "" or unresolved name is already
 *  ""), so a re-run never clobbers a hand-set or already-landed counterpart —
 *  the same idempotency `applyEnrichmentInto` guarantees for categories. */
function applyTransferEnrichmentInto(byId: Map<string, ImportTransaction>, enriched: TransferEnriched[]): number {
  let landed = 0;
  for (const e of enriched) {
    if (!e.targetAccountId) continue;
    const row = byId.get(e.id);
    if (!row || row.targetAccountId) continue;
    byId.set(e.id, { ...row, targetAccountId: e.targetAccountId });
    landed++;
  }
  return landed;
}

/** The pipeline phases the section bar renders, re-exported for consumers. */
export { PIPELINE_PHASES };
