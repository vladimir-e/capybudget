import { describe, it, expect } from "vitest";
import { detectDuplicates, RELAXED_DATE_WINDOW_DAYS } from "./import-duplicates";
import type { ImportTransaction } from "./import-types";
import type { Transaction } from "../entities/types";

function makeImport(overrides: Partial<ImportTransaction> = {}): ImportTransaction {
  return {
    id: crypto.randomUUID(),
    date: "2026-01-15",
    description: "WHOLE FOODS #10234",
    amount: -4550,
    type: "expense",
    sourceAccount: "Chase Checking",
    sourceCategory: "",
    merchant: "",
    accountId: "",
    targetAccountId: "",
    categoryId: "",
    categoryConfidence: "",
    duplicate: false,
    duplicateConfidence: "",
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

  it("low confidence: date within the relaxed window + amount + same account", () => {
    const imp = makeImport({ date: "2026-01-16", description: "OTHER" });
    const ex = makeExisting(); // date: 2026-01-15
    const result = detectDuplicates([imp], [ex], MAPPING);

    expect(result.size).toBe(1);
    expect(result.get(imp.id)!.confidence).toBe("low");
  });

  it("relaxed window works in the other direction too", () => {
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

  it("no match: same amount, date beyond the relaxed window", () => {
    const imp = makeImport({ date: "2026-01-22" }); // 7 days off, window is 3
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

  it("description matching is case-insensitive", () => {
    const imp = makeImport({ description: "WHOLE FOODS #10234" });
    const ex = makeExisting({ note: "Whole Foods #10234 — weekly groceries" });
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

  it("carries the matched transaction's merchant and category", () => {
    const imp = makeImport();
    const ex = makeExisting({ merchant: "Whole Foods", categoryId: "cat-groceries" });
    const result = detectDuplicates([imp], [ex], MAPPING);

    const match = result.get(imp.id)!;
    expect(match.matchedMerchant).toBe("Whole Foods");
    expect(match.matchedCategoryId).toBe("cat-groceries");
  });

  describe("resolved-merchant rule", () => {
    it("high confidence on merchant + account even when descriptions diverge", () => {
      // Raw descriptions differ (ref-number noise), but grounding resolved both
      // to the same canonical merchant.
      const imp = makeImport({ description: "CHECKCARD GINGER 0421 99887", merchant: "" });
      const ex = makeExisting({
        note: "GINGER 0315 11122",
        merchant: "Ginger",
      });
      const result = detectDuplicates(
        [imp],
        [ex],
        MAPPING,
        () => "Ginger", // grounding-resolved merchant
      );

      expect(result.size).toBe(1);
      expect(result.get(imp.id)!.confidence).toBe("high");
    });

    it("uses the row's own merchant field when no resolver is given", () => {
      const imp = makeImport({ description: "DIFFERENT", merchant: "Ginger" });
      const ex = makeExisting({ note: "SOMETHING ELSE", merchant: "Ginger" });
      const result = detectDuplicates([imp], [ex], MAPPING);

      expect(result.get(imp.id)!.confidence).toBe("high");
    });

    it("does not match merchant across different accounts", () => {
      const imp = makeImport({ sourceAccount: "Other", merchant: "Ginger" });
      const ex = makeExisting({ accountId: "acct-1", merchant: "Ginger" });
      const result = detectDuplicates([imp], [ex], { Other: "acct-2" });

      expect(result.size).toBe(0);
    });
  });

  describe("rule 5 — relaxed date window (cross-import transfer legs)", () => {
    // A transfer leg created in account B (from a prior account-A import) is the
    // existing txn; B's own CSV is now imported and the same leg appears a few
    // days off, with a divergent description. Rule 5 catches it: amount + same
    // account within ±RELAXED_DATE_WINDOW_DAYS, low confidence (auto-unselect).
    const legImport = (date: string): ImportTransaction =>
      makeImport({
        type: "transfer", description: "TRANSFER FROM CHECKING",
        amount: 50000, date, sourceAccount: "Chase Checking",
      });
    const legExisting = (date: string): Transaction =>
      makeExisting({
        type: "transfer", transferPairId: "leg-a", note: "MONTHLY SAVINGS MOVE",
        merchant: "", amount: 50000, accountId: "acct-1",
        datetime: `${date}T00:00:00.000`,
      });

    it("matches a leg drifted by the full window (3 days) as a low-confidence dup", () => {
      const imp = legImport("2026-01-18"); // existing leg is 2026-01-15
      const ex = legExisting("2026-01-15");
      const result = detectDuplicates([imp], [ex], MAPPING);

      expect(result.size).toBe(1);
      expect(result.get(imp.id)!.confidence).toBe("low");
    });

    it("matches a window drift in the other direction too", () => {
      const imp = legImport("2026-01-12"); // existing leg is 2026-01-15
      const ex = legExisting("2026-01-15");
      const result = detectDuplicates([imp], [ex], MAPPING);

      expect(result.size).toBe(1);
      expect(result.get(imp.id)!.confidence).toBe("low");
    });

    it("does NOT match a drift beyond the window", () => {
      const imp = legImport("2026-01-19"); // 4 days off, window is 3
      const ex = legExisting("2026-01-15");
      const result = detectDuplicates([imp], [ex], MAPPING);

      expect(result.size).toBe(0);
    });

    it("window is exactly RELAXED_DATE_WINDOW_DAYS (boundary is inclusive)", () => {
      const onEdge = offsetISODate("2026-01-15", RELAXED_DATE_WINDOW_DAYS);
      const beyond = offsetISODate("2026-01-15", RELAXED_DATE_WINDOW_DAYS + 1);
      const ex = legExisting("2026-01-15");

      expect(detectDuplicates([legImport(onEdge)], [ex], MAPPING).size).toBe(1);
      expect(detectDuplicates([legImport(beyond)], [ex], MAPPING).size).toBe(0);
    });

    it("does not match across different accounts even within the window", () => {
      const imp = makeImport({
        type: "transfer", description: "X", amount: 50000,
        date: "2026-01-17", sourceAccount: "BofA",
      });
      const ex = legExisting("2026-01-15"); // accountId acct-1
      const result = detectDuplicates([imp], [ex], { BofA: "acct-2" });

      expect(result.size).toBe(0);
    });

    it("the exact-date high-confidence rules are unaffected by the wider window", () => {
      // Same-day, description matches the note → rule 2 fires (high), not rule 5.
      const imp = makeImport({ description: "WHOLE FOODS #10234" });
      const ex = makeExisting({ note: "WHOLE FOODS #10234 weekly" });
      const result = detectDuplicates([imp], [ex], MAPPING);

      expect(result.get(imp.id)!.confidence).toBe("high");
    });

    it("greedy 1:1 still holds: two drifted imports claim two distinct legs", () => {
      const imp1 = legImport("2026-01-16"); // id auto
      const imp1b = { ...imp1, id: "imp-1" };
      const imp2b = { ...legImport("2026-01-17"), id: "imp-2" };
      const ex1 = legExisting("2026-01-15");
      const ex2 = { ...legExisting("2026-01-15"), id: "ex-2" };
      const result = detectDuplicates([imp1b, imp2b], [ex1, ex2], MAPPING);

      expect(result.size).toBe(2);
      expect(result.get("imp-1")!.existingTransactionId).not.toBe(
        result.get("imp-2")!.existingTransactionId,
      );
    });

    it("two imports compete for one in-window leg: only one claims it (greedy 1:1)", () => {
      const imp1 = { ...legImport("2026-01-16"), id: "imp-1" };
      const imp2 = { ...legImport("2026-01-17"), id: "imp-2" };
      const ex = legExisting("2026-01-15");
      const result = detectDuplicates([imp1, imp2], [ex], MAPPING);

      expect(result.size).toBe(1);
    });
  });

  describe("two-pass precedence — a relaxed match can't steal an exact match's claim", () => {
    it("Netflix/Spotify: a same-amount neighbor doesn't claim the other row's exact dup", () => {
      // Budget has Netflix $9.99 on the 1st. The import has Spotify $9.99 on
      // the 3rd (not a dup — subscriptions share price points) and the real
      // Netflix $9.99 on the 1st. Spotify iterates first: a single greedy pass
      // would let it claim the Netflix txn via rule 5 (false duplicate) and
      // leave the real Netflix row with its exact match already taken (missed
      // duplicate). The high-confidence pass must claim first.
      const spotify = makeImport({
        id: "imp-spotify", date: "2026-01-03",
        description: "SPOTIFY USA", merchant: "Spotify", amount: -999,
      });
      const netflix = makeImport({
        id: "imp-netflix", date: "2026-01-01",
        description: "NETFLIX.COM", merchant: "Netflix", amount: -999,
      });
      const existingNetflix = makeExisting({
        datetime: "2026-01-01T00:00:00.000", amount: -999,
        merchant: "Netflix", note: "NETFLIX.COM",
      });

      const result = detectDuplicates([spotify, netflix], [existingNetflix], MAPPING);

      expect(result.size).toBe(1);
      expect(result.get("imp-netflix")!.confidence).toBe("high");
      expect(result.has("imp-spotify")).toBe(false);
    });

    it("pass-1 claims win even when the weak-matching row comes first in file order", () => {
      // Same day, amount, and account for both rows; only the second one's
      // description matches the existing note. The rule-4 candidate row must
      // not claim the txn the rule-2 row matches.
      const weak = makeImport({ id: "imp-weak", description: "MYSTERY CHARGE" });
      const strong = makeImport({ id: "imp-strong" }); // description matches the note
      const ex = makeExisting();

      const result = detectDuplicates([weak, strong], [ex], MAPPING);

      expect(result.size).toBe(1);
      expect(result.get("imp-strong")!.confidence).toBe("high");
      expect(result.has("imp-weak")).toBe(false);
    });
  });
});

/** Local date arithmetic mirroring the module's internal offsetDate, for
 *  boundary assertions that key off RELAXED_DATE_WINDOW_DAYS. */
function offsetISODate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
