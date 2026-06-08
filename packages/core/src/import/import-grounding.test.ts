import { describe, it, expect } from "vitest";
import {
  makeAccount,
  makeCategory,
  makeTransaction,
  makeImportTransaction,
} from "../test-factories";
import { groundImport, type GroundImportInput } from "./import-grounding";
import type { Account, Category, Transaction } from "../entities/types";
import type { ImportTransaction } from "./import-types";

// ── Shared fixtures ──────────────────────────────────────────────

const GROCERIES = makeCategory({ id: "cat-groceries", name: "Groceries", group: "Daily Living" });
const RENT = makeCategory({ id: "cat-rent", name: "Housing", group: "Fixed" });
const DINING = makeCategory({ id: "cat-dining", name: "Dining Out", group: "Daily Living" });
const OTHER_INCOME = makeCategory({ id: "cat-income", name: "Other Income", group: "Income" });

const CHECKING = makeAccount({ id: "acct-checking", name: "Chase Checking" });
const SAVINGS = makeAccount({ id: "acct-savings", name: "Ally Savings" });
const BROKERAGE = makeAccount({ id: "acct-brokerage", name: "Fidelity Brokerage" });

function input(over: Partial<GroundImportInput> = {}): GroundImportInput {
  return {
    rows: [],
    history: [],
    accounts: [CHECKING],
    categories: [GROCERIES, RENT, DINING, OTHER_INCOME],
    ...over,
  };
}

/** A historical transfer: two paired legs on the given accounts, sharing one
 *  note (the description that future imports match against). */
function transferLegs(
  note: string,
  fromAccountId: string,
  toAccountId: string,
  datetime: string,
  idPrefix: string,
): Transaction[] {
  const fromId = `${idPrefix}-from`;
  const toId = `${idPrefix}-to`;
  return [
    makeTransaction({
      id: fromId, type: "transfer", merchant: "", note, categoryId: "",
      accountId: fromAccountId, transferPairId: toId, amount: -50000, datetime,
    }),
    makeTransaction({
      id: toId, type: "transfer", merchant: "", note, categoryId: "",
      accountId: toAccountId, transferPairId: fromId, amount: 50000, datetime,
    }),
  ];
}

/** N historical txns for one merchant, all in one category, recent-ish dates. */
function historyFor(
  merchant: string,
  categoryId: string,
  count: number,
): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      id: `${merchant}-${categoryId}-${i}`,
      merchant,
      note: merchant.toUpperCase(),
      categoryId,
      accountId: "acct-checking",
      datetime: `2025-${String(1 + (i % 9)).padStart(2, "0")}-15T00:00:00.000`,
    }),
  );
}

// ── Fast-path resolver ───────────────────────────────────────────

describe("groundImport — fast-path resolver", () => {
  it("fast-paths a row with strong, unanimous history (>= 3 matches, 100% agreement)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS #998" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5) }),
    );

    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.merchant).toBe("Whole Foods");
    expect(r.categoryId).toBe("cat-groceries");
    expect(r.categoryConfidence).toBe("high");
  });

  it("does NOT fast-path below the minimum match count (2 < 3)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 2) }),
    );
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("fast-paths at exactly 3 matches with 100% agreement (lower boundary)", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 3) }),
    );
    expect(results.get("r1")!.resolution).toBe("fast-path");
  });

  it("fast-paths at exactly 80% category agreement (4 of 5)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 4),
      makeTransaction({
        id: "wf-dissent",
        merchant: "Whole Foods",
        note: "WHOLE FOODS",
        categoryId: "cat-dining",
        datetime: "2025-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-groceries");
  });

  it("does NOT fast-path below 80% agreement (3 of 5 = 60%)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 3),
      makeTransaction({ id: "d1", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-dining" }),
      makeTransaction({ id: "d2", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("agreement counts uncategorized matches against unanimity", () => {
    // 3 categorized (groceries) + 2 with no/invalid category = 3/5 = 60% < 80%.
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 3),
      makeTransaction({ id: "u1", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "" }),
      makeTransaction({ id: "u2", merchant: "Whole Foods", note: "WHOLE FOODS", categoryId: "gone-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(input({ rows: [row], history }));
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });

  it("honors tunable thresholds via options", () => {
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 2) }),
      { minMatches: 2 },
    );
    expect(results.get("r1")!.resolution).toBe("fast-path");
  });

  it("never fast-paths a transfer row", () => {
    const row = makeImportTransaction({ id: "r1", type: "transfer", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5) }),
    );
    expect(results.get("r1")!.resolution).not.toBe("fast-path");
  });
});

// ── Context sidecar (top-3 + stats distiller) ────────────────────

describe("groundImport — context sidecar", () => {
  it("attaches the top-3 most-recent examples", () => {
    const history = [
      makeTransaction({ id: "old", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2024-01-15T00:00:00.000" }),
      makeTransaction({ id: "mid", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2025-06-15T00:00:00.000" }),
      makeTransaction({ id: "new", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2026-01-15T00:00:00.000" }),
      makeTransaction({ id: "oldest", merchant: "Ginger", note: "GINGER", categoryId: "cat-rent", datetime: "2023-01-15T00:00:00.000" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "GINGER 0421" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.examples.length).toBe(3);
    // Most-recent first.
    expect(ctx.examples.map((e) => e.date)).toEqual(["2026-01-15", "2025-06-15", "2024-01-15"]);
  });

  it("distills merchant counts (the Ginger example)", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "Ginger", note: "ZELLE GINGER", categoryId: "cat-rent" }),
      makeTransaction({ id: "2", merchant: "Ginger", note: "ZELLE GINGER", categoryId: "cat-rent" }),
      makeTransaction({ id: "3", merchant: "Ginger Zelle", note: "GINGER ZELLE", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ZELLE GINGER" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.merchantStats).toEqual([
      { name: "Ginger", count: 2 },
      { name: "Ginger Zelle", count: 1 },
    ]);
  });

  it("distills category counts (Rent x22, Housekeeping x3 shape)", () => {
    const history = [
      ...historyFor("Acme Property", "cat-rent", 22),
      ...historyFor("Acme Property", "cat-dining", 3),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME PROPERTY" });
    const { context } = groundImport(input({ rows: [row], history }));

    const ctx = context.get("r1")!;
    expect(ctx.categoryStats[0]).toEqual({ name: "cat-rent", count: 22 });
    expect(ctx.categoryStats[1]).toEqual({ name: "cat-dining", count: 3 });
  });

  it("excludes invalid/archived category ids from category stats", () => {
    const history = [
      ...historyFor("Acme", "cat-rent", 3),
      makeTransaction({ id: "x", merchant: "Acme", note: "ACME", categoryId: "deleted-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const names = context.get("r1")!.categoryStats.map((c) => c.name);
    expect(names).not.toContain("deleted-cat");
  });

  it("writes no context entry for a row with no history match", () => {
    const row = makeImportTransaction({ id: "r1", description: "BRAND NEW MERCHANT" });
    const { context } = groundImport(input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 3) }));
    expect(context.has("r1")).toBe(false);
  });

  it("omits empty example fields rather than carrying them as empty strings", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "", note: "ACME", categoryId: "cat-rent" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const example = context.get("r1")!.examples[0];
    expect(example).not.toHaveProperty("merchant");
    expect(example.note).toBe("ACME");
    expect(example.categoryId).toBe("cat-rent");
  });

  it("drops a dead/archived category id from an example (never shown as unknown)", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "Acme", note: "ACME", categoryId: "deleted-cat" }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "ACME" });
    const { context } = groundImport(input({ rows: [row], history }));

    const example = context.get("r1")!.examples[0];
    expect(example).not.toHaveProperty("categoryId");
    expect(example.merchant).toBe("Acme");
  });
});

// ── sourceAccount resolution + sourceCategory non-backfill ───────

describe("groundImport — sourceAccount resolution", () => {
  it("resolves sourceAccount to a budget account by name", () => {
    const row = makeImportTransaction({ id: "r1", sourceAccount: "Chase Checking" });
    const { results } = groundImport(input({ rows: [row] }));
    expect(results.get("r1")!.accountId).toBe("acct-checking");
  });

  it("prefers an explicit account alias over name matching", () => {
    const row = makeImportTransaction({ id: "r1", sourceAccount: "CHK-9988" });
    const { results } = groundImport(
      input({ rows: [row], accountMapping: { "CHK-9988": "acct-checking" } }),
    );
    expect(results.get("r1")!.accountId).toBe("acct-checking");
  });
});

// ── Transfer counterpart resolution (the "From account") ─────────

describe("groundImport — transfer counterpart resolution", () => {
  const accounts = [CHECKING, SAVINGS, BROKERAGE];

  it("suggests the counterpart account from a matching historical transfer", () => {
    // Past transfer: Checking → Savings, noted "MONTHLY TRANSFER TO SAVINGS".
    const history = transferLegs(
      "MONTHLY TRANSFER TO SAVINGS", "acct-checking", "acct-savings",
      "2025-12-15T00:00:00.000", "t1",
    );
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "MONTHLY TRANSFER TO SAVINGS",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));

    const r = results.get("r1")!;
    expect(r.accountId).toBe("acct-checking"); // the row's own ("To") side
    expect(r.targetAccountId).toBe("acct-savings"); // the counterpart ("From")
  });

  it("never suggests the row's own resolved account as the counterpart", () => {
    const history = transferLegs(
      "TRANSFER SAVINGS", "acct-checking", "acct-savings",
      "2025-12-15T00:00:00.000", "t1",
    );
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "TRANSFER SAVINGS",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));

    const r = results.get("r1")!;
    expect(r.targetAccountId).not.toBe(r.accountId);
    expect(r.targetAccountId).toBe("acct-savings");
  });

  it("leaves targetAccountId empty when no historical transfer matches", () => {
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "BRAND NEW TRANSFER LABEL",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history: transferLegs(
        "SOMETHING UNRELATED", "acct-checking", "acct-savings",
        "2025-12-15T00:00:00.000", "t1",
      ), accounts }),
    );
    expect(results.get("r1")!.targetAccountId).toBe("");
  });

  it("does not draw a counterpart from non-transfer history matches", () => {
    // A plain expense whose description happens to match — never a counterpart.
    const history = [
      makeTransaction({
        id: "e1", type: "expense", merchant: "Acme", note: "VENMO PAYMENT",
        accountId: "acct-savings", categoryId: "cat-groceries",
        datetime: "2025-12-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "VENMO PAYMENT",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));
    expect(results.get("r1")!.targetAccountId).toBe("");
  });

  it("picks the most-frequent counterpart across matches", () => {
    // Two past transfers Checking→Savings, one Checking→Brokerage: Savings wins.
    const history = [
      ...transferLegs("WIRE OUT", "acct-checking", "acct-savings", "2025-10-15T00:00:00.000", "a"),
      ...transferLegs("WIRE OUT", "acct-checking", "acct-savings", "2025-11-15T00:00:00.000", "b"),
      ...transferLegs("WIRE OUT", "acct-checking", "acct-brokerage", "2025-12-15T00:00:00.000", "c"),
    ];
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "WIRE OUT",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));
    expect(results.get("r1")!.targetAccountId).toBe("acct-savings");
  });

  it("breaks a frequency tie by the most-recent supporting leg", () => {
    // One transfer to each of Savings / Brokerage; Brokerage is more recent.
    const history = [
      ...transferLegs("EQUAL SPLIT", "acct-checking", "acct-savings", "2025-06-15T00:00:00.000", "a"),
      ...transferLegs("EQUAL SPLIT", "acct-checking", "acct-brokerage", "2025-12-15T00:00:00.000", "b"),
    ];
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "EQUAL SPLIT",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(input({ rows: [row], history, accounts }));
    expect(results.get("r1")!.targetAccountId).toBe("acct-brokerage");
  });

  it("skips a counterpart that is no longer a current non-archived account", () => {
    // The paired leg lives on an account that has since been deleted/archived.
    const history = transferLegs(
      "OLD TRANSFER", "acct-checking", "acct-gone",
      "2025-12-15T00:00:00.000", "t1",
    );
    const row = makeImportTransaction({
      id: "r1", type: "transfer", description: "OLD TRANSFER",
      sourceAccount: "Chase Checking",
    });
    // acct-gone is not in the accounts list → not a valid counterpart.
    const { results } = groundImport(input({ rows: [row], history, accounts }));
    expect(results.get("r1")!.targetAccountId).toBe("");
  });

  it("non-transfer rows always have an empty targetAccountId", () => {
    const row = makeImportTransaction({ id: "r1", type: "expense", description: "WHOLE FOODS" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Whole Foods", "cat-groceries", 5), accounts }),
    );
    expect(results.get("r1")!.targetAccountId).toBe("");
  });
});

describe("groundImport — sourceCategory is never backfilled", () => {
  it('does NOT assign "Other Income" from the bank\'s coarse "Other" label', () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "UNKNOWN MERCHANT XYZ",
      type: "expense",
      sourceCategory: "Other",
    });
    const { results } = groundImport(input({ rows: [row] }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
    expect(r.categoryConfidence).toBe("");
  });

  it("leaves a row with a specific sourceCategory ambiguous (the model decides)", () => {
    const row = makeImportTransaction({
      id: "r1",
      description: "UNKNOWN MERCHANT XYZ",
      sourceCategory: "Groceries",
    });
    const { results } = groundImport(input({ rows: [row] }));

    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
    expect(r.merchant).toBe("");
  });

  it("leaves a truly ambiguous row ambiguous", () => {
    const row = makeImportTransaction({ id: "r1", description: "MYSTERY CHARGE", sourceCategory: "" });
    const { results } = groundImport(input({ rows: [row] }));
    expect(results.get("r1")!.resolution).toBe("ambiguous");
  });
});

// ── Type guard on deterministic assignments ──────────────────────

describe("groundImport — type guard", () => {
  it("does NOT fast-path an expense into an Income-group category, even with dominant history", () => {
    // A TurboTax refund the user once filed as income shouldn't pull a TurboTax
    // expense into Other Income — the row goes to the model instead.
    const row = makeImportTransaction({ id: "r1", description: "TURBOTAX", type: "expense" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("TurboTax", "cat-income", 5) }),
    );
    const r = results.get("r1")!;
    expect(r.resolution).toBe("ambiguous");
    expect(r.categoryId).toBe("");
  });

  it("fast-paths an income row into an Income-group category", () => {
    const row = makeImportTransaction({ id: "r1", description: "ACME PAYROLL", type: "income" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Acme Payroll", "cat-income", 5) }),
    );
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-income");
  });

  it("does NOT fast-path an income row into an expense category", () => {
    const row = makeImportTransaction({ id: "r1", description: "ACME DEPOSIT", type: "income" });
    const { results } = groundImport(
      input({ rows: [row], history: historyFor("Acme Deposit", "cat-groceries", 5) }),
    );
    expect(results.get("r1")!.resolution).toBe("ambiguous");
  });

  it("ignores wrong-type history but still fast-paths on a type-correct majority", () => {
    // 4 expense-category matches + 1 income-category dissenter = 4/5 = 80%.
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 4),
      makeTransaction({
        id: "wf-income",
        merchant: "Whole Foods",
        note: "WHOLE FOODS",
        categoryId: "cat-income",
        datetime: "2025-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({ id: "r1", description: "WHOLE FOODS", type: "expense" });
    const { results } = groundImport(input({ rows: [row], history }));
    const r = results.get("r1")!;
    expect(r.resolution).toBe("fast-path");
    expect(r.categoryId).toBe("cat-groceries");
  });
});

// ── Duplicate folding ────────────────────────────────────────────

describe("groundImport — duplicate folding", () => {
  function dupSetup(): {
    rows: ImportTransaction[];
    history: Transaction[];
    accounts: Account[];
    categories: Category[];
  } {
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "Whole Foods",
      note: "WHOLE FOODS #998",
      categoryId: "cat-groceries",
      accountId: "acct-checking",
      amount: -4550,
      datetime: "2026-01-15T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "WHOLE FOODS #998",
      amount: -4550,
      date: "2026-01-15",
      sourceAccount: "Chase Checking",
    });
    return {
      rows: [row],
      history: [existing],
      accounts: [CHECKING],
      categories: [GROCERIES, RENT, DINING],
    };
  }

  it("marks an exact re-import as a duplicate and carries merchant + category", () => {
    const { results } = groundImport(dupSetup());
    const r = results.get("r1")!;
    expect(r.resolution).toBe("duplicate");
    expect(r.duplicate).toBe(true);
    expect(r.merchant).toBe("Whole Foods");
    expect(r.categoryId).toBe("cat-groceries");
    expect(r.duplicateMatch?.existingTransactionId).toBe("ex-1");
  });

  it("counts a duplicate as resolved (skips enrichment) in stats", () => {
    const { stats } = groundImport(dupSetup());
    expect(stats.duplicates).toBe(1);
    expect(stats.resolved).toBe(1);
  });

  it("dedup leverages the fast-path-resolved merchant even when descriptions diverge", () => {
    const history = [
      ...historyFor("Ginger", "cat-rent", 3), // makes the row fast-path to "Ginger"
      makeTransaction({
        id: "ex-dup",
        merchant: "Ginger",
        note: "GINGER 0315 OLD-REF",
        categoryId: "cat-rent",
        accountId: "acct-checking",
        amount: -150000,
        datetime: "2026-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({
      id: "r1",
      description: "GINGER 0421 NEW-REF-9988",
      amount: -150000,
      date: "2026-02-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history, accounts: [CHECKING], categories: [GROCERIES, RENT, DINING] }),
    );
    expect(results.get("r1")!.duplicate).toBe(true);
  });

  it("keeps the fast-pathed category when the matched dup has an empty categoryId", () => {
    // Row fast-paths to Ginger/cat-rent from history, then matches a duplicate
    // existing txn that itself is uncategorized. The dup flag must not clobber
    // the category code already resolved. 4 categorized + 1 uncategorized dup =
    // 80% agreement, so the row still fast-paths before dedup runs.
    const history = [
      ...historyFor("Ginger", "cat-rent", 4),
      makeTransaction({
        id: "ex-dup",
        merchant: "Ginger",
        note: "GINGER",
        categoryId: "", // uncategorized existing transaction
        accountId: "acct-checking",
        amount: -150000,
        datetime: "2026-02-15T00:00:00.000",
      }),
    ];
    const row = makeImportTransaction({
      id: "r1",
      description: "GINGER 0421",
      amount: -150000,
      date: "2026-02-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history, accounts: [CHECKING], categories: [GROCERIES, RENT, DINING] }),
    );

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.categoryId).toBe("cat-rent"); // fast-path category survives
    expect(r.categoryConfidence).toBe("high"); // and its confidence
    expect(r.merchant).toBe("Ginger");
  });

  it("does NOT carry a wrong-type category from a matched dup (keeps the merchant)", () => {
    // The existing txn this expense duplicates was miscategorized as income —
    // carry its merchant for display, but never its income category.
    const existing = makeTransaction({
      id: "ex-1",
      merchant: "TurboTax",
      note: "TURBOTAX FEE",
      categoryId: "cat-income", // wrong type for an expense
      accountId: "acct-checking",
      amount: -8900,
      datetime: "2026-01-15T00:00:00.000",
    });
    const row = makeImportTransaction({
      id: "r1",
      description: "TURBOTAX FEE",
      type: "expense",
      amount: -8900,
      date: "2026-01-15",
      sourceAccount: "Chase Checking",
    });
    const { results } = groundImport(
      input({ rows: [row], history: [existing] }),
    );

    const r = results.get("r1")!;
    expect(r.duplicate).toBe(true);
    expect(r.merchant).toBe("TurboTax"); // merchant carried for display
    expect(r.categoryId).toBe(""); // income category NOT carried
    expect(r.categoryConfidence).toBe(""); // and no high confidence on it
  });
});

// ── Stats ────────────────────────────────────────────────────────

describe("groundImport — stats", () => {
  it("tallies total / fastPathed / ambiguous / resolved across rows", () => {
    const rows = [
      makeImportTransaction({ id: "fast", description: "WHOLE FOODS" }),
      makeImportTransaction({ id: "ambig", description: "ZZZ MYSTERY" }),
      makeImportTransaction({ id: "cat", description: "QQQ UNKNOWN", sourceCategory: "Groceries" }),
    ];
    const { stats } = groundImport(
      input({ rows, history: historyFor("Whole Foods", "cat-groceries", 4) }),
    );
    expect(stats.total).toBe(3);
    expect(stats.fastPathed).toBe(1);
    // The sourceCategory hint is no longer backfilled — both non-fast-path rows
    // are ambiguous and go to the classifier.
    expect(stats.ambiguous).toBe(2);
    expect(stats.resolved).toBe(1);
  });

  it("indexes history once and grounds many rows (performance shape)", () => {
    const history = [
      ...historyFor("Whole Foods", "cat-groceries", 50),
      ...historyFor("Acme Rent", "cat-rent", 50),
    ];
    const rows = Array.from({ length: 200 }, (_, i) =>
      makeImportTransaction({
        id: `r${i}`,
        description: i % 2 === 0 ? "WHOLE FOODS MARKET" : "ACME RENT PAYMENT",
      }),
    );
    const { results, stats } = groundImport(input({ rows, history }));
    expect(results.size).toBe(200);
    expect(stats.fastPathed).toBe(200);
  });
});
