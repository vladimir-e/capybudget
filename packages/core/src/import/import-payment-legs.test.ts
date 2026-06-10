import { describe, it, expect } from "vitest";
import { makeAccount } from "../test-factories";
import { PaymentLegMatcher, PAYMENT_KEYWORDS } from "./import-payment-legs";

// The account set the recognizer was calibrated against — a real budget's
// shape: emoji-prefixed names, two short-named cards, a one-word Cash account.
const APPLE_CARD = makeAccount({ id: "acct-apple", name: "🍏 Apple Card", type: "credit" });
const CHASE_PRIME = makeAccount({ id: "acct-chase", name: "📦 Chase Prime Rewards", type: "credit" });
const CAPITAL_ONE = makeAccount({ id: "acct-capone", name: "🛒 Capital One BJ's", type: "credit" });
const CASH = makeAccount({ id: "acct-cash", name: "💵 Cash", type: "cash" });
const BOFA_CHECKING = makeAccount({ id: "acct-bofa-chk", name: "🏦 BofA Checking" });
const BOFA_SAVINGS = makeAccount({ id: "acct-bofa-sav", name: "💰 BofA Savings", type: "savings" });
const BOFA_VISA = makeAccount({ id: "acct-bofa-visa", name: "💳 BofA Rewards Visa", type: "credit" });

const ACCOUNTS = [APPLE_CARD, CHASE_PRIME, CAPITAL_ONE, CASH, BOFA_CHECKING, BOFA_SAVINGS, BOFA_VISA];

const matcher = new PaymentLegMatcher(ACCOUNTS);

describe("PaymentLegMatcher — the four real BofA-export shapes", () => {
  it("recognizes a concatenated card name via trigram containment (APPLECARD → 🍏 Apple Card)", () => {
    // Zero token overlap ("applecard" is one token, the account has two) — the
    // trigram channel is what carries this.
    expect(matcher.match("APPLECARD GSBANK DES:PAYMENT ID:M1234", "acct-bofa-chk")).toBe("acct-apple");
  });

  it("recognizes a partial name via token coverage (CAPITAL ONE → 🛒 Capital One BJ's)", () => {
    // 2 of the account's 3 significant tokens appear — enough to clear the
    // token-coverage threshold.
    expect(matcher.match("CAPITAL ONE DES:MOBILE PMT ID:X99887", "acct-bofa-chk")).toBe("acct-capone");
  });

  it("does NOT match on a bare brand token (CHASE alone — accepted miss)", () => {
    // 1 of 3 tokens of "Chase Prime Rewards" is below threshold by design: a
    // brand-only signal is too weak to pin a single card. The model's
    // transferPatterns own this phrasing.
    expect(matcher.match("CHASE CREDIT CRD DES:EPAY ID:12345", "acct-bofa-chk")).toBeNull();
  });

  it("does NOT match a card named only by number (CRD 9044 — detectType's pattern owns it)", () => {
    // No account name appears at all; the built-in "payment to crd" transfer
    // pattern catches this during Normalizing instead.
    expect(matcher.match("Mobile Banking payment to CRD 9044 Confirmation# 2241", "acct-bofa-chk")).toBeNull();
  });
});

describe("PaymentLegMatcher — precision guards", () => {
  it("a one-short-token account never participates (CASH APP is not the Cash account)", () => {
    // "CASH APP *PAYMENT SENT" is a real P2P expense. The "Cash" account is too
    // weak a name to match inside a longer description.
    expect(matcher.match("CASH APP *PAYMENT SENT", "acct-bofa-chk")).toBeNull();
  });

  it("a payment keyword without an account-name match does nothing (Zelle to a person)", () => {
    expect(matcher.match("Zelle payment to Dima Evdokimov", "acct-bofa-chk")).toBeNull();
  });

  it("an account-name match without a payment keyword does nothing", () => {
    // The other half of the conjunction: naming alone may not fire.
    expect(matcher.match("CAPITAL ONE DES:MONTHLY FEE", "acct-bofa-chk")).toBeNull();
  });

  it("excludes the row's own account", () => {
    expect(matcher.match("ONLINE PAYMENT BOFA CHECKING", "acct-bofa-chk")).toBeNull();
    // The same description from another account's perspective does match.
    expect(matcher.match("ONLINE PAYMENT BOFA CHECKING", "acct-apple")).toBe("acct-bofa-chk");
  });

  it("two accounts clearing threshold is ambiguity — no action", () => {
    const sapphire = makeAccount({ id: "acct-sapphire", name: "Chase Sapphire" });
    const reserve = makeAccount({ id: "acct-reserve", name: "Chase Sapphire Reserve" });
    const ambiguous = new PaymentLegMatcher([BOFA_CHECKING, sapphire, reserve]);
    expect(ambiguous.match("CHASE SAPPHIRE EPAY ID:777", "acct-bofa-chk")).toBeNull();
    // With a single candidate the same description resolves.
    const single = new PaymentLegMatcher([BOFA_CHECKING, sapphire]);
    expect(single.match("CHASE SAPPHIRE EPAY ID:777", "acct-bofa-chk")).toBe("acct-sapphire");
  });
});

describe("PAYMENT_KEYWORDS", () => {
  it("each keyword fires the conjunction when paired with a clean account name", () => {
    for (const keyword of PAYMENT_KEYWORDS) {
      expect(matcher.match(`BOFA SAVINGS ${keyword.toUpperCase()}`, "acct-bofa-chk")).toBe("acct-bofa-sav");
    }
  });
});
