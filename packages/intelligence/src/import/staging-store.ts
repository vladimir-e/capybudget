/**
 * The staging-store seam — the orchestrator's only window onto `.capy/import/`.
 *
 * `.capy/import/` is the single source of truth for resume: where the user
 * lands on reopen is a pure function of which artifacts exist. The orchestrator
 * never touches a filesystem directly; it reads and writes through this
 * interface, so the engine is headless and unit-testable against an in-memory
 * double. Unit 3 supplies the concrete {@link FileStagingStore}.
 *
 * ```
 * .capy/import/
 *   sources/          # original files (read-only to the engine)
 *   transactions.csv  # normalized staging (written during Normalizing)
 *   context.json      # per-row history signals (written during History)
 *   state.json        # phase + metadata
 * ```
 */

import Papa from "papaparse";
import {
  serializeImportCsv,
  validateImportTransactions,
  type ImportTransaction,
  type RowContext,
} from "@capybudget/core";
import type { FileAdapter } from "@capybudget/persistence";
import type { ImportPhase } from "./events";

/** A source file the engine reads for Normalizing. `content` is the file's
 *  bytes — UTF-8 text for CSV, base64 for image/PDF (see `mediaType`). */
export interface SourceFile {
  name: string;
  /** UTF-8 text (CSV) or base64 (image/PDF), per `mediaType`. */
  content: string;
  mediaType: string;
}

/** What `state.json` records — phase plus run metadata for resume + the UI. */
export interface ImportState {
  phase: ImportPhase;
  /** Set once Normalizing writes rows; lets resume know staging exists. */
  rowCount?: number;
  /** ISO timestamp of the last state write. */
  updatedAt: string;
  /**
   * Who staged this run. `"chat"` marks a Capy-initiated import (the
   * `start_import` tool dropped sources and wrote this before any phase ran),
   * which the Import screen auto-starts on mount. A manual drop in the Import
   * tab writes only `sources/` and never `state.json`, so its absence is the
   * "waiting for the user to press Start" signal — the two on-ramps stay
   * distinguishable by which artifacts exist, not a separate flag the UI tracks.
   */
  source?: "chat";
}

/**
 * The orchestrator's persistence seam. All methods are async — the concrete
 * impl is filesystem-backed. The in-memory test double implements the same
 * contract.
 */
export interface StagingStore {
  /** Source files to normalize, in order. */
  listSources(): Promise<SourceFile[]>;
  /** Drop one file into `sources/`. `content` is the file's bytes the same way
   *  {@link SourceFile.content} carries them — UTF-8 text for CSV, base64 for
   *  image/PDF — so it round-trips through {@link listSources} unchanged. The
   *  chat on-ramp uses this to stage an attachment; the Import tab writes
   *  sources through its own disk hook. */
  writeSource(name: string, content: string): Promise<void>;

  /** The staged rows, or `null` if `transactions.csv` doesn't exist yet. */
  readTransactions(): Promise<ImportTransaction[] | null>;
  /** Overwrite `transactions.csv` with the given rows. */
  writeTransactions(rows: ImportTransaction[]): Promise<void>;

  /** The per-row history context, or `null` if `context.json` doesn't exist. */
  readContext(): Promise<Record<string, RowContext> | null>;
  /** Overwrite `context.json`. */
  writeContext(context: Record<string, RowContext>): Promise<void>;

  /** The run state, or `null` if `state.json` doesn't exist. */
  readState(): Promise<ImportState | null>;
  /** Overwrite `state.json`. */
  writeState(state: ImportState): Promise<void>;

  /** Remove `transactions.csv`, `context.json`, `state.json`, and `sources/`.
   *  Used when a run dies before staging exists — clears stale artifacts so
   *  reopen lands cleanly on file-attach. */
  clear(): Promise<void>;
}

/** Parse a serialized `transactions.csv` back into typed rows. Mirrors
 *  `serializeImportCsv`'s columns; missing/extra columns degrade gracefully
 *  (empty string) so a hand-edited or partially-written file still loads.
 *
 *  This is the resume seam — it reads staging written by an earlier run, a
 *  crash mid-write, or the user's own hand-edits, none of which the type
 *  system guards. `validateImportTransactions` is the gate: it backfills a
 *  missing id and drops rows with a malformed date/amount/type so the
 *  orchestrator never enriches and merges a garbage row. Dropped rows are
 *  warned, not swallowed silently. */
export function parseImportCsv(content: string): ImportTransaction[] {
  const { data } = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rows = data.map((row): ImportTransaction => {
    // `Number("")` is 0 (finite), so a blank cell would otherwise survive
    // validation and merge as a real $0 transaction. Map blank → NaN so the
    // single non-finite-amount rule in `validateImportTransactions` drops it.
    const raw = row.amount?.trim() ?? "";
    const amount = raw === "" ? NaN : Number(raw);
    return {
      id: row.id ?? "",
      date: row.date ?? "",
      description: row.description ?? "",
      amount: Number.isFinite(amount) ? amount : NaN,
      type: (row.type as ImportTransaction["type"]) || "expense",
      sourceAccount: row.sourceAccount ?? "",
      sourceCategory: row.sourceCategory ?? "",
      merchant: row.merchant ?? "",
      accountId: row.accountId ?? "",
      targetAccountId: row.targetAccountId ?? "",
      categoryId: row.categoryId ?? "",
      categoryConfidence: row.categoryConfidence ?? "",
      duplicate: row.duplicate === "true",
    };
  });
  const { valid, warnings } = validateImportTransactions(rows);
  if (warnings.length > 0) {
    console.warn(`[import] staging validation dropped/fixed rows:\n${warnings.join("\n")}`);
  }
  return valid;
}

const IMPORT_DIR_REL = ".capy/import";

/**
 * Filesystem-backed {@link StagingStore} over the shared {@link FileAdapter}.
 *
 * Imports only `intelligence` / `persistence` types, so it lives in the
 * intelligence layer per `STRUCTURE.md` and any consumer (the app, a CLI)
 * reuses it. Unit 3 constructs one with the Tauri file adapter; tests use the
 * in-memory double instead.
 */
export class FileStagingStore implements StagingStore {
  constructor(
    private readonly fileAdapter: FileAdapter,
    private readonly budgetPath: string,
  ) {}

  private async dir(): Promise<string> {
    const dir = await this.fileAdapter.join(this.budgetPath, IMPORT_DIR_REL);
    await this.fileAdapter.mkdir(dir, { recursive: true });
    return dir;
  }

  private async path(name: string): Promise<string> {
    return this.fileAdapter.join(await this.dir(), name);
  }

  async listSources(): Promise<SourceFile[]> {
    const sourcesDir = await this.fileAdapter.join(await this.dir(), "sources");
    if (!(await this.fileAdapter.exists(sourcesDir))) return [];
    const entries = await this.fileAdapter.readDir(sourcesDir);
    const files: SourceFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile) continue;
      const filePath = await this.fileAdapter.join(sourcesDir, entry.name);
      const content = await this.fileAdapter.readFile(filePath);
      files.push({ name: entry.name, content, mediaType: mediaTypeFor(entry.name) });
    }
    return files;
  }

  async writeSource(name: string, content: string): Promise<void> {
    const sourcesDir = await this.fileAdapter.join(await this.dir(), "sources");
    await this.fileAdapter.mkdir(sourcesDir, { recursive: true });
    await this.fileAdapter.writeFile(await this.fileAdapter.join(sourcesDir, name), content);
  }

  async readTransactions(): Promise<ImportTransaction[] | null> {
    const p = await this.path("transactions.csv");
    if (!(await this.fileAdapter.exists(p))) return null;
    return parseImportCsv(await this.fileAdapter.readFile(p));
  }

  async writeTransactions(rows: ImportTransaction[]): Promise<void> {
    await this.fileAdapter.writeFile(await this.path("transactions.csv"), serializeImportCsv(rows));
  }

  async readContext(): Promise<Record<string, RowContext> | null> {
    const p = await this.path("context.json");
    if (!(await this.fileAdapter.exists(p))) return null;
    return JSON.parse(await this.fileAdapter.readFile(p));
  }

  async writeContext(context: Record<string, RowContext>): Promise<void> {
    await this.fileAdapter.writeFile(await this.path("context.json"), JSON.stringify(context));
  }

  async readState(): Promise<ImportState | null> {
    const p = await this.path("state.json");
    if (!(await this.fileAdapter.exists(p))) return null;
    return JSON.parse(await this.fileAdapter.readFile(p));
  }

  async writeState(state: ImportState): Promise<void> {
    await this.fileAdapter.writeFile(await this.path("state.json"), JSON.stringify(state));
  }

  async clear(): Promise<void> {
    const dir = await this.dir();
    for (const name of ["transactions.csv", "context.json", "state.json"]) {
      const p = await this.fileAdapter.join(dir, name);
      if (await this.fileAdapter.exists(p)) await this.fileAdapter.remove(p);
    }
    const sourcesDir = await this.fileAdapter.join(dir, "sources");
    if (await this.fileAdapter.exists(sourcesDir)) {
      await this.fileAdapter.remove(sourcesDir, { recursive: true });
    }
  }
}

function mediaTypeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    default:
      return "text/csv";
  }
}
