import { describe, it, expect } from "vitest";
import { serializeImportCsv, type ImportTransaction } from "@capybudget/core";
import { makeImportTransaction } from "@capybudget/core/test-factories";
import type { DirEntry, FileAdapter, FileStat } from "@capybudget/persistence";
import { FileStagingStore, parseImportCsv } from "./staging-store";

describe("parseImportCsv", () => {
  it("round-trips serialized staging back into typed rows", () => {
    const rows: ImportTransaction[] = [
      makeImportTransaction({ id: "imp-1", amount: -2500, merchant: "Whole Foods", categoryId: "cat-1", categoryConfidence: "high", duplicate: true }),
      makeImportTransaction({ id: "imp-2", amount: 200000, type: "income", description: 'WITH, COMMA "quote"' }),
    ];
    const parsed = parseImportCsv(serializeImportCsv(rows));

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ id: "imp-1", amount: -2500, merchant: "Whole Foods", categoryConfidence: "high", duplicate: true });
    expect(parsed[1]).toMatchObject({ id: "imp-2", amount: 200000, type: "income", description: 'WITH, COMMA "quote"', duplicate: false });
  });

  it("defaults missing columns gracefully", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,2026-01-01,-100");
    expect(parsed[0]).toMatchObject({ id: "imp-1", amount: -100, merchant: "", categoryId: "", type: "expense", duplicate: false });
  });

  it("coerces a corrupt amount to 0 rather than NaN", () => {
    const parsed = parseImportCsv("id,date,amount\nimp-1,2026-01-01,not-a-number");
    expect(parsed[0].amount).toBe(0);
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

    expect((await store.readTransactions())![0].merchant).toBe("X");
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
});
