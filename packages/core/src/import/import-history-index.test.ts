import { describe, it, expect } from "vitest";
import { makeTransaction } from "../test-factories";
import { HistoryIndex, buildMatchQuery } from "./import-history-index";

describe("HistoryIndex", () => {
  it("matches a row against a historical merchant", () => {
    const index = new HistoryIndex([
      makeTransaction({ merchant: "Whole Foods", note: "WHOLE FOODS #123" }),
    ]);
    const matches = index.match(buildMatchQuery("WHOLE FOODS MARKET #987654"));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].txn.merchant).toBe("Whole Foods");
  });

  it("matches against a prior note when the merchant is empty", () => {
    const index = new HistoryIndex([
      makeTransaction({ merchant: "", note: "GINGER RESTAURANT" }),
    ]);
    const matches = index.match(buildMatchQuery("GINGER RESTAURANT 0421"));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].source).toBe("note");
  });

  it("ranks merchant-source matches above note-source at equal score", () => {
    const viaMerchant = makeTransaction({
      id: "m",
      merchant: "Ginger",
      note: "unrelated text here",
      datetime: "2026-01-01T00:00:00.000",
    });
    const viaNote = makeTransaction({
      id: "n",
      merchant: "Something Else Entirely",
      note: "Ginger",
      datetime: "2026-01-01T00:00:00.000",
    });
    const index = new HistoryIndex([viaNote, viaMerchant]);
    const matches = index.match(buildMatchQuery("Ginger"));
    expect(matches[0].txn.id).toBe("m");
    expect(matches[0].source).toBe("merchant");
  });

  it("a Ginger-style example: variants all resolve to the same merchant", () => {
    const history = [
      makeTransaction({ id: "1", merchant: "Ginger", note: "GINGER ZELLE PAYMENT" }),
      makeTransaction({ id: "2", merchant: "Ginger", note: "GINGER RENT" }),
      makeTransaction({ id: "3", merchant: "Ginger Zelle", note: "ZELLE TO GINGER" }),
    ];
    const index = new HistoryIndex(history);
    const matches = index.match(buildMatchQuery("ZELLE PAYMENT GINGER 998877"));
    const matchedMerchants = new Set(matches.map((m) => m.txn.merchant));
    expect(matchedMerchants.has("Ginger")).toBe(true);
  });

  it("does not match unrelated merchants", () => {
    const index = new HistoryIndex([
      makeTransaction({ merchant: "Netflix", note: "NETFLIX.COM" }),
    ]);
    const matches = index.match(buildMatchQuery("WHOLE FOODS MARKET"));
    expect(matches).toEqual([]);
  });

  it("an exact canonical match scores 1", () => {
    const index = new HistoryIndex([makeTransaction({ merchant: "Costco" })]);
    const matches = index.match(buildMatchQuery("Costco"));
    expect(matches[0].score).toBe(1);
  });

  it("ignores history rows with empty merchant and note", () => {
    const index = new HistoryIndex([makeTransaction({ merchant: "", note: "" })]);
    expect(index.match(buildMatchQuery("anything"))).toEqual([]);
  });

  it("respects minScore", () => {
    const loose = new HistoryIndex([makeTransaction({ merchant: "Trader Joes Market" })], {
      minScore: 0.2,
    });
    const strict = new HistoryIndex([makeTransaction({ merchant: "Trader Joes Market" })], {
      minScore: 0.95,
    });
    const q = buildMatchQuery("Trader Joes");
    expect(loose.match(q).length).toBeGreaterThan(0);
    expect(strict.match(q).length).toBe(0);
  });

  it("returns one match per distinct transaction", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      makeTransaction({ id: `h${i}`, merchant: "Amazon", note: "AMAZON.COM" }),
    );
    const index = new HistoryIndex(history);
    expect(index.match(buildMatchQuery("Amazon")).length).toBe(30);
  });

  it("a transaction matching via both merchant and note counts once (merchant wins)", () => {
    const index = new HistoryIndex([
      makeTransaction({ id: "dup", merchant: "Spotify", note: "SPOTIFY USA" }),
    ]);
    const matches = index.match(buildMatchQuery("Spotify"));
    // One transaction → one match, attributed to the merchant source.
    expect(matches.length).toBe(1);
    expect(matches[0].txn.id).toBe("dup");
    expect(matches[0].source).toBe("merchant");
  });

  describe("processor-prefixed rows match clean-merchant history", () => {
    it("'CHECK CARD PURCHASE NETFLIX' matches Netflix history", () => {
      const index = new HistoryIndex([makeTransaction({ merchant: "Netflix" })]);
      const matches = index.match(buildMatchQuery("CHECK CARD PURCHASE NETFLIX"));
      expect(matches.length).toBe(1);
      expect(matches[0].txn.merchant).toBe("Netflix");
    });

    it("'SQ *COFFEE BAR' matches Coffee Bar history", () => {
      const index = new HistoryIndex([makeTransaction({ merchant: "Coffee Bar" })]);
      const matches = index.match(buildMatchQuery("SQ *COFFEE BAR"));
      expect(matches.length).toBe(1);
      expect(matches[0].txn.merchant).toBe("Coffee Bar");
    });

    it("'TST* RESTAURANT' matches Restaurant history", () => {
      const index = new HistoryIndex([makeTransaction({ merchant: "Restaurant" })]);
      const matches = index.match(buildMatchQuery("TST* RESTAURANT"));
      expect(matches.length).toBe(1);
      expect(matches[0].txn.merchant).toBe("Restaurant");
    });
  });

  describe("single-token query precision", () => {
    it("a single-token query matches a multi-token merchant containing it", () => {
      const index = new HistoryIndex([makeTransaction({ merchant: "Uber Eats" })]);
      const matches = index.match(buildMatchQuery("Uber"));
      expect(matches.length).toBe(1);
    });

    it("a single-token query does not trigram-match an unrelated longer merchant", () => {
      // "uber" shares trigrams with "tuber farm" but is not a whole token there.
      const index = new HistoryIndex([makeTransaction({ merchant: "Tuber Farm Supply" })]);
      const matches = index.match(buildMatchQuery("Uber"));
      expect(matches).toEqual([]);
    });
  });
});
