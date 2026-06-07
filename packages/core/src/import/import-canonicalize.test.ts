import { describe, it, expect } from "vitest";
import { canonicalizeMatchKey, tokenize, trigrams } from "./import-canonicalize";

describe("canonicalizeMatchKey", () => {
  it("lowercases and collapses whitespace", () => {
    expect(canonicalizeMatchKey("  Whole   Foods  Market ")).toBe("whole foods market");
  });

  it("strips emoji", () => {
    expect(canonicalizeMatchKey("☕ Starbucks")).toBe("starbucks");
  });

  it("strips a trailing long reference number", () => {
    expect(canonicalizeMatchKey("WHOLE FOODS #10234567")).toBe("whole foods");
  });

  it("strips a trailing auth/confirmation token", () => {
    expect(canonicalizeMatchKey("AMAZON.COM AUTH AB12CD34")).toBe("amazon.com");
  });

  it("strips a trailing card tail", () => {
    expect(canonicalizeMatchKey("TARGET ENDING 4821")).toBe("target");
  });

  it("strips a trailing isolated date", () => {
    expect(canonicalizeMatchKey("UBER TRIP 01/15")).toBe("uber trip");
  });

  it("keeps a store number that is part of the merchant name short", () => {
    // 7-Eleven keeps its name; only a long trailing digit run would be stripped.
    expect(canonicalizeMatchKey("7-Eleven")).toBe("7-eleven");
  });

  it("strips leading + trailing noise, keeping the merchant in the middle", () => {
    const a = canonicalizeMatchKey("CHECKCARD GINGER AUTH 11122");
    const b = canonicalizeMatchKey("CHECKCARD GINGER AUTH 99887");
    expect(a).toBe(b);
    expect(a).toBe("ginger");
  });

  it("falls back to the collapsed form when stripping eats everything", () => {
    expect(canonicalizeMatchKey("#000123456")).toBe("#000123456");
  });

  it("is idempotent — canonicalizing a key again is a no-op", () => {
    const once = canonicalizeMatchKey("CHECK CARD PURCHASE NETFLIX #10234567");
    expect(canonicalizeMatchKey(once)).toBe(once);
  });

  describe("leading processor-prefix stripping", () => {
    it("strips 'CHECK CARD PURCHASE'", () => {
      expect(canonicalizeMatchKey("CHECK CARD PURCHASE NETFLIX")).toBe("netflix");
    });

    it("strips 'POS DEBIT'", () => {
      expect(canonicalizeMatchKey("POS DEBIT WHOLE FOODS")).toBe("whole foods");
    });

    it("strips 'DEBIT CARD PURCHASE'", () => {
      expect(canonicalizeMatchKey("DEBIT CARD PURCHASE TRADER JOES")).toBe("trader joes");
    });

    it("strips 'PURCHASE AUTHORIZED ON'", () => {
      expect(canonicalizeMatchKey("PURCHASE AUTHORIZED ON 03/15 SPOTIFY")).toBe("spotify");
    });

    it("strips a 'SQ *' gateway tag", () => {
      expect(canonicalizeMatchKey("SQ *COFFEE")).toBe("coffee");
    });

    it("strips a 'TST*' gateway tag", () => {
      expect(canonicalizeMatchKey("TST* RESTAURANT")).toBe("restaurant");
    });

    it("strips a 'PAYPAL *' gateway tag", () => {
      expect(canonicalizeMatchKey("PAYPAL *STEAM GAMES")).toBe("steam games");
    });

    it("does not bite into a merchant whose name starts with a prefix word", () => {
      // "Purchasing Power" is a real merchant — the word boundary check protects it.
      expect(canonicalizeMatchKey("Purchasing Power")).toBe("purchasing power");
    });

    it("falls back when the whole string is a prefix", () => {
      expect(canonicalizeMatchKey("POS DEBIT")).toBe("pos debit");
    });

    it("strips both a prefix and trailing ref noise together", () => {
      expect(canonicalizeMatchKey("POS DEBIT NETFLIX.COM AUTH 998877")).toBe("netflix.com");
    });
  });
});

describe("tokenize", () => {
  it("splits on non-alphanumerics and drops 1-char tokens", () => {
    expect(tokenize("whole foods market")).toEqual(["whole", "foods", "market"]);
  });

  it("keeps alphanumeric tokens", () => {
    expect(tokenize("store 5th ave")).toEqual(["store", "5th", "ave"]);
  });

  it("drops single characters", () => {
    expect(tokenize("a b cd")).toEqual(["cd"]);
  });
});

describe("trigrams", () => {
  it("produces sliding character trigrams", () => {
    expect(trigrams("abcd")).toEqual(["abc", "bcd"]);
  });

  it("removes whitespace before gramming", () => {
    expect(trigrams("ab cd")).toEqual(["abc", "bcd"]);
  });

  it("returns the whole string when shorter than 3", () => {
    expect(trigrams("ab")).toEqual(["ab"]);
  });

  it("returns empty for an empty key", () => {
    expect(trigrams("")).toEqual([]);
  });
});
