import { describe, it, expect } from "vitest";
import { detectDuplicates } from "./import-duplicates";
import type { ImportTransaction } from "./import-types";
import type { Transaction } from "./types";

function makeImport(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-01-15",
    description: "WHOLE FOODS #10234",
    amount: -4550,
    type: "expense",
    sourceAccount: "Chase Checking",
    sourceCategory: "",
    memo: "",
    merchant: "",
    accountId: "",
    categoryId: "",
    categoryConfidence: "",
    ...overrides,
  };
}

function makeExisting(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    datetime: "2026-01-15T00:00:00.000",
    type: "expense",
    amount: -4550,
    categoryId: "",
    accountId: "acct-1",
    transferPairId: "",
    merchant: "Whole Foods",
    note: "WHOLE FOODS #10234",
    createdAt: "2026-01-10T00:00:00.000",
    ...overrides,
  };
}

const MAPPING: Record<string, string> = {
  "Chase Checking": "acct-1",
};

describe("detectDuplicates", () => {
  it("returns empty map when no existing transactions", () => {
    const result = detectDuplicates([makeImport()], [], MAPPING);
    expect(result.size).toBe(0);
  });

  it("high confidence: date + amount + description + same account", () => {
    const imp = makeImport();
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    const match = result.get(imp.id)!;
    expect(match.confidence).toBe("high");
    expect(match.existingTransactionId).toBe(ex.id);
  });

  it("high confidence: date + amount + description, no account info", () => {
    const imp = makeImport({ sourceAccount: "", accountId: "" });
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], {});

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("high");
  });

  it("low confidence: date + amount + same account, description differs", () => {
    const imp = makeImport({ description: "DIFFERENT MERCHANT" });
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("low");
  });

  it("low confidence: date + amount + same account, description empty", () => {
    const imp = makeImport({ description: "" });
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("low");
  });

  it("low confidence: date ±1 day + amount + same account", () => {
    const imp = makeImport({ date: "2026-01-16", description: "OTHER" });
    const ex = makeExisting(); // date: 2026-01-15
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("low");
  });

  it("date ±1 day works in the other direction too", () => {
    const imp = makeImport({ date: "2026-01-14", description: "OTHER" });
    const ex = makeExisting(); // date: 2026-01-15
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("low");
  });

  it("no match: same date, different amount", () => {
    const imp = makeImport({ amount: -9999 });
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(0);
  });

  it("no match: same amount, date >1 day apart", () => {
    const imp = makeImport({ date: "2026-01-18" });
    const ex = makeExisting(); // date: 2026-01-15
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(0);
  });

  it("account-scoped: same date+amount on different accounts = not duplicate", () => {
    const imp = makeImport({ sourceAccount: "BofA Checking" });
    const ex = makeExisting({ accountId: "acct-1" });
    const mapping = { "BofA Checking": "acct-2" };
    const result = detectDuplicates([imp], [ex], mapping);

    // No high match (description matches but different account → rule 1 fails)
    // Rule 2 skipped (has account)
    // Rule 3: same date+amount but different account → fails
    // Rule 4: same day range but different account → fails
    expect(result.size).toBe(0);
  });

  it("greedy 1:1 matching: one existing can only match one import", () => {
    const imp1 = makeImport({ id: "imp-1" });
    const imp2 = makeImport({ id: "imp-2" });
    const ex = makeExisting();
    const result = detectDuplicates([imp1, imp2], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.has("imp-1")).toBe(true);
    expect(result.has("imp-2")).toBe(false);
  });

  it("matches two imports to two different existing transactions", () => {
    const imp1 = makeImport({ id: "imp-1" });
    const imp2 = makeImport({ id: "imp-2" });
    const ex1 = makeExisting({ id: "ex-1" });
    const ex2 = makeExisting({ id: "ex-2" });
    const result = detectDuplicates([imp1, imp2], [ex1, ex2], MAPPING);

    expect(result.size).toBe(2);
    expect(result.get("imp-1")!.existingTransactionId).toBe("ex-1");
    expect(result.get("imp-2")!.existingTransactionId).toBe("ex-2");
  });

  it("prefers higher confidence match", () => {
    // Import has description + account → should get high confidence (rule 1)
    // not fall through to low confidence (rule 3)
    const imp = makeImport();
    const ex = makeExisting();
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.get(imp.id)!.confidence).toBe("high");
  });

  it("description matching checks note contains import description", () => {
    // Existing note is "WHOLE FOODS #10234 — weekly groceries"
    const imp = makeImport({ description: "WHOLE FOODS #10234" });
    const ex = makeExisting({ note: "WHOLE FOODS #10234 — weekly groceries" });
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("high");
  });

  it("uses accountId from import when sourceAccount has no mapping", () => {
    const imp = makeImport({ sourceAccount: "", accountId: "acct-1" });
    const ex = makeExisting({ accountId: "acct-1" });
    const result = detectDuplicates([imp], [ex], {});

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("high");
  });
});
