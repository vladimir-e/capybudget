import { describe, it, expect } from "vitest";
import { serializeImportCsv, type ImportTransaction } from "@capybudget/core";
import { makeImportTransaction } from "@capybudget/core/test-factories";
import type { DirEntry, FileAdapter, FileStat } from "@capybudget/persistence";
import { FileStagingStore, parseImportCsv } from "./staging-store";

describe("parseImportCsv", () => {
  it("round-trips serialized staging back into typed rows", () => {
    const rows: ImportTransaction[] = [
      makeImportTransaction({ id: "imp-1", amount: -2500, merchant: "Whole Foods", categoryId: "cat-1", categoryConfidence: "high", duplicate: true, duplicateConfidence: "low" }),
      makeImportTransaction({ id: "imp-2", amount: 200000, type: "income", description: 'WITH, COMMA "quote"' }),
    ];
    const parsed = parseImportCsv(serializeImportCsv(rows));

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.dropped).toHaveLength(0);
    expect(parsed.fixed).toHaveLength(0);
    expect(parsed.rows[0]).toMatchObject({ id: "imp-1", amount: -2500, merchant: "Whole Foods", categoryConfidence: "high", duplicate: true, duplicateConfidence: "low" });
    expect(parsed.rows[1]).toMatchObject({ id: "imp-2", amount: 200000, type: "income", description: 'WITH, COMMA "quote"', duplicate: false, duplicateConfidence: "" });
  });

  it("defaults missing columns gracefully", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,2026-01-01,-100");
    expect(parsed.rows[0]).toMatchObject({ id: "imp-1", amount: -100, merchant: "", categoryId: "", type: "expense", duplicate: false, duplicateConfidence: "" });
  });

  it("degrades a garbage duplicateConfidence value to empty", () => {
    const parsed = parseImportCsv("id,date,amount,duplicate,duplicateConfidence\nimp-1,2026-01-01,-100,true,maybe");
    expect(parsed.rows[0]).toMatchObject({ duplicate: true, duplicateConfidence: "" });
  });

  // The resume seam reads staging an earlier run, a crash, or a hand-edit
  // wrote — none type-checked. Validation drops genuinely-broken rows so the
  // orchestrator never enriches and merges a garbage row, and reports them
  // back so the caller can surface the skip.
  it("drops a row whose amount isn't a number", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,2026-01-01,not-a-number");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.dropped).toEqual([expect.stringContaining("invalid amount")]);
  });

  it("drops a row with a malformed date", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,March 1st,-100");
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.dropped).toEqual([expect.stringContaining("invalid date")]);
  });

  it("keeps a deliberate zero-amount row", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,2026-01-01,0");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].amount).toBe(0);
  });

  // `Number("")` is 0, so a blank amount would merge as a real $0 transaction
  // unless parse maps it to NaN for validation to drop. Distinct from "0".
  it("drops a row with a blank amount", () => {
    const parsed = parseImportCsv('id,date,amount,description\nimp-1,2026-01-01,," "');
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.dropped).toEqual([expect.stringContaining("invalid amount")]);
  });

  it("heals a staged row with no sourceAccount to Imported", () => {
    const parsed = parseImportCsv("id,date,amount,sourceAccount\nimp-1,2026-01-01,-100,");
    expect(parsed.rows[0].sourceAccount).toBe("Imported");
  });

  it("backfills a missing id as a fix, not a drop", () => {
    const parsed = parseImportCsv("id,date,amount\n,2026-01-01,-100");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].id).toBeTruthy();
    expect(parsed.fixed).toEqual([expect.stringContaining("missing id")]);
    expect(parsed.dropped).toHaveLength(0);
  });

  it("notes every dropped row so the preview can say how many were skipped", () => {
    const parsed = parseImportCsv(
      "id,date,amount\nimp-1,Pending,-100\nimp-2,2026-01-01,oops\nimp-3,2026-01-02,-200",
    );
    expect(parsed.rows.map((r) => r.id)).toEqual(["imp-3"]);
    expect(parsed.dropped).toHaveLength(2);
  });
});

/** Minimal in-memory FileAdapter for the FileStagingStore tests. */
function memoryFileAdapter(seed: Record<string, string> = {}): FileAdapter {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  return {
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: ${path}`);
      return v;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async rename(from, to) {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    async join(...parts) {
      return parts.join("/");
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path) || [...files.keys()].some((k) => k.startsWith(path + "/"));
    },
    async readDir(path) {
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(path + "/")) {
          const rest = key.slice(path.length + 1);
          if (!rest.includes("/")) names.add(rest);
        }
      }
      return [...names].map((name): DirEntry => ({ name, isFile: true, isDirectory: false }));
    },
    async appendFile(path, content) {
      files.set(path, (files.get(path) ?? "") + content);
    },
    async remove(path) {
      files.delete(path);
      for (const key of [...files.keys()]) if (key.startsWith(path + "/")) files.delete(key);
      dirs.delete(path);
    },
    async stat(path): Promise<FileStat> {
      return { size: (files.get(path) ?? "").length, isFile: files.has(path), isDirectory: dirs.has(path) };
    },
  };
}

describe("FileStagingStore", () => {
  const BASE = "/budget/.capy/import";

  it("reads sources with media types inferred from extension", async () => {
    const fa = memoryFileAdapter({
      [`${BASE}/sources/statement.csv`]: "Date,Amount\n2026-01-01,-1",
      [`${BASE}/sources/receipt.png`]: "BASE64",
    });
    const store = new FileStagingStore(fa, "/budget");

    const sources = await store.listSources();
    expect(sources).toHaveLength(2);
    expect(sources.find((s) => s.name === "statement.csv")?.mediaType).toBe("text/csv");
    expect(sources.find((s) => s.name === "receipt.png")?.mediaType).toBe("image/png");
  });

  it("writeSource drops a file into sources/ that listSources reads back", async () => {
    const store = new FileStagingStore(memoryFileAdapter(), "/budget");
    await store.writeSource("apple-card.csv", "Date,Amount\n2026-01-01,-4.50");

    const sources = await store.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "apple-card.csv",
      content: "Date,Amount\n2026-01-01,-4.50",
      mediaType: "text/csv",
    });
  });

  it("returns null for transactions/context/state before they exist", async () => {
    const store = new FileStagingStore(memoryFileAdapter(), "/budget");
    expect(await store.readTransactions()).toBeNull();
    expect(await store.readContext()).toBeNull();
    expect(await store.readState()).toBeNull();
  });

  it("writes then reads transactions, context, and state", async () => {
    const store = new FileStagingStore(memoryFileAdapter(), "/budget");
    const rows = [makeImportTransaction({ id: "imp-1", merchant: "X" })];
    await store.writeTransactions(rows);
    await store.writeContext({ "imp-1": { examples: [], merchantStats: [], categoryStats: [] } });
    await store.writeState({ phase: "history", rowCount: 1, updatedAt: "2026-01-01T00:00:00Z" });

    expect((await store.readTransactions())!.rows[0].merchant).toBe("X");
    expect(await store.readContext()).toHaveProperty("imp-1");
    expect((await store.readState())?.phase).toBe("history");
  });

  it("clear() removes staging artifacts and sources", async () => {
    const fa = memoryFileAdapter({ [`${BASE}/sources/a.csv`]: "x" });
    const store = new FileStagingStore(fa, "/budget");
    await store.writeTransactions([makeImportTransaction()]);
    await store.clear();

    expect(await store.readTransactions()).toBeNull();
    expect(await store.listSources()).toHaveLength(0);
  });

  // Staging exists for crash-resume, so writes go through a tmp-then-rename swap.
  // A torn JSON cache (a crash mid-write, or a hand-edit) must read as "no signal"
  // rather than throw — null lands the user on preview with Enrich ready, never a
  // hard-error screen.
  it("reads a corrupt context.json as null instead of throwing", async () => {
    const fa = memoryFileAdapter({ [`${BASE}/context.json`]: "{not valid json" });
    const store = new FileStagingStore(fa, "/budget");
    expect(await store.readContext()).toBeNull();
  });

  it("reads a corrupt state.json as null instead of throwing", async () => {
    const fa = memoryFileAdapter({ [`${BASE}/state.json`]: "{not valid json" });
    const store = new FileStagingStore(fa, "/budget");
    expect(await store.readState()).toBeNull();
  });

  it("reads a corrupt transfer-context.json as null instead of throwing", async () => {
    const fa = memoryFileAdapter({ [`${BASE}/transfer-context.json`]: "}{" });
    const store = new FileStagingStore(fa, "/budget");
    expect(await store.readTransferContext()).toBeNull();
  });

  it("leaves no .tmp artifact behind after an atomic write", async () => {
    const fa = memoryFileAdapter();
    const store = new FileStagingStore(fa, "/budget");
    await store.writeTransactions([makeImportTransaction({ id: "imp-1" })]);
    await store.writeState({ phase: "history", rowCount: 1, updatedAt: "2026-01-01T00:00:00Z" });

    expect(await fa.exists(`${BASE}/transactions.csv.tmp`)).toBe(false);
    expect(await fa.exists(`${BASE}/state.json.tmp`)).toBe(false);
    expect((await store.readTransactions())!.rows[0].id).toBe("imp-1");
  });
});
