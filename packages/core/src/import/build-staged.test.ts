import { describe, it, expect } from "vitest";
import { buildStaged, DESCRIPTION_MAX_LENGTH } from "./build-staged";
import type { StagedRecord } from "./import-types";

function record(overrides: Partial<StagedRecord> = {}): StagedRecord {
  return {
    date: "2026-01-15",
    amount: -2500,
    type: "expense",
    description: "GROCERY STORE",
    sourceAccount: "Checking",
    sourceCategory: "",
    ...overrides,
  };
}

describe("buildStaged", () => {
  describe("id assignment", () => {
    it("assigns sequential imp-N ids starting at 1", () => {
      const result = buildStaged([record(), record(), record()]);
      expect(result.map((t) => t.id)).toEqual(["imp-1", "imp-2", "imp-3"]);
    });

    it("starts from startId for multi-file append", () => {
      const result = buildStaged([record(), record()], { startId: 50 });
      expect(result.map((t) => t.id)).toEqual(["imp-50", "imp-51"]);
    });

    it("empty input yields empty output", () => {
      expect(buildStaged([])).toEqual([]);
    });
  });

  describe("description trim-45", () => {
    it("trims a long description to 45 chars", () => {
      const long = "WALMART SUPERCENTER #1234 PURCHASE AUTH 998877665544";
      expect(long.length).toBeGreaterThan(DESCRIPTION_MAX_LENGTH);
      const [t] = buildStaged([record({ description: long })]);
      expect(t.description).toHaveLength(DESCRIPTION_MAX_LENGTH);
      expect(t.description).toBe(long.slice(0, DESCRIPTION_MAX_LENGTH));
    });

    it("leaves a short description untouched", () => {
      const [t] = buildStaged([record({ description: "STARBUCKS" })]);
      expect(t.description).toBe("STARBUCKS");
    });

    it("trims surrounding whitespace before capping", () => {
      const [t] = buildStaged([record({ description: "   Coffee Shop   " })]);
      expect(t.description).toBe("Coffee Shop");
    });

    it("cap boundary: exactly 45 chars stays whole", () => {
      const exact = "x".repeat(DESCRIPTION_MAX_LENGTH);
      const [t] = buildStaged([record({ description: exact })]);
      expect(t.description).toBe(exact);
    });

    it("does not split a surrogate pair at the cap boundary", () => {
      // 44 ASCII + one astral emoji = the 45th code point spans two UTF-16 units.
      const desc = "y".repeat(DESCRIPTION_MAX_LENGTH - 1) + "🎉";
      const [t] = buildStaged([record({ description: desc })]);
      expect([...t.description]).toHaveLength(DESCRIPTION_MAX_LENGTH);
      expect(t.description.endsWith("🎉")).toBe(true);
      // No lone surrogate (a naive slice(0,45) would leave half the emoji).
      expect(t.description).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });
  });

  describe("sign / type normalization", () => {
    it("preserves a signed expense amount", () => {
      const [t] = buildStaged([record({ amount: -2500, type: "expense" })]);
      expect(t.amount).toBe(-2500);
      expect(t.type).toBe("expense");
    });

    it("preserves a signed income amount", () => {
      const [t] = buildStaged([record({ amount: 300000, type: "income" })]);
      expect(t.amount).toBe(300000);
      expect(t.type).toBe("income");
    });

    it("normalizes negative zero to zero", () => {
      const [t] = buildStaged([record({ amount: -0 })]);
      expect(Object.is(t.amount, -0)).toBe(false);
      expect(t.amount).toBe(0);
    });

    it("carries the transfer type through", () => {
      const [t] = buildStaged([record({ type: "transfer", amount: -1000 })]);
      expect(t.type).toBe("transfer");
    });
  });

  describe("defaults", () => {
    it("leaves resolved fields empty — those are History's / enrichment's job", () => {
      const [t] = buildStaged([record()]);
      expect(t.merchant).toBe("");
      expect(t.accountId).toBe("");
      expect(t.targetAccountId).toBe("");
      expect(t.categoryId).toBe("");
      expect(t.categoryConfidence).toBe("");
    });

    it("carries the source channels verbatim", () => {
      const [t] = buildStaged([
        record({ sourceAccount: "Amex Gold", sourceCategory: "Dining" }),
      ]);
      expect(t.sourceAccount).toBe("Amex Gold");
      expect(t.sourceCategory).toBe("Dining");
    });
  });
});
