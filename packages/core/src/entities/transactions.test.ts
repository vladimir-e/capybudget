import { describe, it, expect } from "vitest";
import { makeTransaction as makeTxn } from "@capybudget/core/test-factories";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type TransactionFormData,
} from "./transactions";

describe("createTransaction", () => {
  it("creates an income transaction with positive amount", () => {
    const input: TransactionFormData = {
      type: "income",
      amount: 10000,
      categoryId: "cat-income",
      accountId: "acc-checking",
      date: "2026-03-01",
      merchant: "Employer",
      note: "salary",
    };

    const result = createTransaction(input, []);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.type).toBe("income");
    expect(txn.amount).toBe(10000);
    expect(txn.categoryId).toBe("cat-income");
    expect(txn.accountId).toBe("acc-checking");
    expect(txn.merchant).toBe("Employer");
    expect(txn.note).toBe("salary");
    expect(txn.transferPairId).toBe("");
    expect(txn.datetime).toMatch(/^2026-03-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(txn.id).toBeTruthy();
    expect(txn.createdAt).toBeTruthy();
  });

  it("creates an expense transaction with negative amount", () => {
    const input: TransactionFormData = {
      type: "expense",
      amount: 3500,
      categoryId: "cat-food",
      accountId: "acc-cash",
      date: "2026-03-02",
      merchant: "Grocery",
      note: "",
    };

    const result = createTransaction(input, []);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.type).toBe("expense");
    expect(txn.amount).toBe(-3500);
    expect(txn.merchant).toBe("Grocery");
    expect(txn.transferPairId).toBe("");
  });

  it("appends to existing transactions", () => {
    const existing = [makeTxn()];
    const input: TransactionFormData = {
      type: "income",
      amount: 1000,
      categoryId: "cat-1",
      accountId: "acc-1",
      date: "2026-03-01",
      merchant: "Test",
      note: "",
    };

    const result = createTransaction(input, existing);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(existing[0]);
  });

  describe("transfer", () => {
    const transferInput: TransactionFormData = {
      type: "transfer",
      amount: 25000,
      categoryId: "",
      accountId: "acc-checking",
      toAccountId: "acc-savings",
      date: "2026-03-05",
      merchant: "",
      note: "monthly savings",
    };

    it("creates two linked transactions", () => {
      const result = createTransaction(transferInput, []);
      expect(result).toHaveLength(2);
    });

    it("from leg has negative amount and source account", () => {
      const result = createTransaction(transferInput, []);
      const from = result[0];
      expect(from.amount).toBe(-25000);
      expect(from.accountId).toBe("acc-checking");
      expect(from.type).toBe("transfer");
    });

    it("to leg has positive amount and destination account", () => {
      const result = createTransaction(transferInput, []);
      const to = result[1];
      expect(to.amount).toBe(25000);
      expect(to.accountId).toBe("acc-savings");
      expect(to.type).toBe("transfer");
    });

    it("legs have mutual transferPairIds", () => {
      const result = createTransaction(transferInput, []);
      const from = result[0];
      const to = result[1];
      expect(from.transferPairId).toBe(to.id);
      expect(to.transferPairId).toBe(from.id);
    });

    it("both legs have empty categoryId and merchant", () => {
      const result = createTransaction(transferInput, []);
      for (const leg of result) {
        expect(leg.categoryId).toBe("");
        expect(leg.merchant).toBe("");
      }
    });

    it("both legs share the note", () => {
      const result = createTransaction(transferInput, []);
      for (const leg of result) {
        expect(leg.note).toBe("monthly savings");
      }
    });

    it("stamps the same rate on both legs (same-currency transfer)", () => {
      const result = createTransaction({ ...transferInput, fxRate: 0.011 }, []);
      expect(result[0].fxRate).toBe(0.011);
      expect(result[1].fxRate).toBe(0.011);
    });

    it("mirrors the amount on the to leg when toAmount is absent (same-currency)", () => {
      const result = createTransaction(transferInput, []);
      expect(result[0].amount).toBe(-25000);
      expect(result[1].amount).toBe(25000);
    });

    describe("cross-currency", () => {
      // $100 (USD, default) → €92 (EUR), the EUR leg carrying its derived bank
      // rate 100/92, the USD leg empty (1.0).
      const crossInput: TransactionFormData = {
        type: "transfer",
        amount: 10000,
        categoryId: "",
        accountId: "acc-usd",
        toAccountId: "acc-eur",
        date: "2026-03-05",
        merchant: "",
        note: "",
        toAmount: 9200,
        fxRate: undefined,
        toFxRate: 10000 / 9200,
      };

      it("each leg carries its own native amount", () => {
        const [from, to] = createTransaction(crossInput, []);
        expect(from.amount).toBe(-10000);
        expect(from.accountId).toBe("acc-usd");
        expect(to.amount).toBe(9200);
        expect(to.accountId).toBe("acc-eur");
      });

      it("each leg carries its own stamped rate", () => {
        const [from, to] = createTransaction(crossInput, []);
        expect(from.fxRate).toBeUndefined();
        expect(to.fxRate).toBeCloseTo(10000 / 9200, 12);
      });

      it("the two legs net to ~0 in the default at the stamped rates", () => {
        const [from, to] = createTransaction(crossInput, []);
        const net = from.amount * (from.fxRate ?? 1) + to.amount * (to.fxRate ?? 1);
        expect(net).toBeCloseTo(0, 6);
      });
    });
  });

  describe("fxRate stamping", () => {
    const base: TransactionFormData = {
      type: "expense",
      amount: 5000,
      categoryId: "cat-food",
      accountId: "acc-rub",
      date: "2026-03-02",
      merchant: "Pyaterochka",
      note: "",
    };

    it("writes the caller's stamped rate onto the created transaction", () => {
      const [txn] = createTransaction({ ...base, fxRate: 0.011 }, []);
      expect(txn.fxRate).toBe(0.011);
    });

    it("leaves fxRate empty when the caller passes none (default-currency = 1.0)", () => {
      const [txn] = createTransaction(base, []);
      expect(txn.fxRate).toBeUndefined();
    });
  });

  // Default RUB. A cross-currency transfer to IDR with exact-cent amounts (money
  // is ×100 for every currency, IDR included): 10,000 ₽ out, 1,758,000 IDR in,
  // the IDR leg stamping the derived rate fromAmount/toAmount.
  describe("cross-currency transfer (RUB → IDR)", () => {
    const RUB_OUT = 1_000_000; // 10,000 ₽ in cents
    const IDR_IN = 175_800_000; // 1,758,000 IDR in cents
    const IDR_RATE = RUB_OUT / IDR_IN; // ₽ per IDR-unit, derived from the amounts

    const input: TransactionFormData = {
      type: "transfer",
      amount: RUB_OUT,
      categoryId: "",
      accountId: "acc-rub",
      toAccountId: "acc-idr",
      date: "2026-06-01",
      merchant: "",
      note: "",
      toAmount: IDR_IN,
      fxRate: undefined, // RUB from-leg is the default → empty
      toFxRate: IDR_RATE,
    };

    it("from leg is the RUB outflow with no rate; to leg is the IDR inflow with its derived rate", () => {
      const [from, to] = createTransaction(input, []);
      expect(from.amount).toBe(-RUB_OUT);
      expect(from.accountId).toBe("acc-rub");
      expect(from.fxRate).toBeUndefined();
      expect(to.amount).toBe(IDR_IN);
      expect(to.accountId).toBe("acc-idr");
      expect(to.fxRate).toBe(IDR_RATE);
    });

    it("the two legs net to exactly 0 ₽ at the stamped rates (no phantom FX)", () => {
      const [from, to] = createTransaction(input, []);
      // -1_000_000 ₽ + 175_800_000 IDR-cents × (1_000_000/175_800_000) = 0.
      const net = from.amount * (from.fxRate ?? 1) + to.amount * (to.fxRate ?? 1);
      expect(net).toBe(0);
    });
  });
});

describe("updateTransaction", () => {
  it("updates income transaction fields", () => {
    const existing = [
      makeTxn({ id: "inc-1", type: "income", amount: 10000, categoryId: "cat-salary", merchant: "Old Corp" }),
    ];
    const input: TransactionFormData = {
      id: "inc-1",
      type: "income",
      amount: 12000,
      categoryId: "cat-bonus",
      accountId: "acc-2",
      date: "2026-04-01",
      merchant: "New Corp",
      note: "raise",
    };

    const result = updateTransaction(input, existing);
    expect(result).toHaveLength(1);

    const txn = result[0];
    expect(txn.id).toBe("inc-1");
    expect(txn.amount).toBe(12000);
    expect(txn.categoryId).toBe("cat-bonus");
    expect(txn.accountId).toBe("acc-2");
    expect(txn.merchant).toBe("New Corp");
    expect(txn.note).toBe("raise");
    expect(txn.datetime).toMatch(/^2026-04-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("updates expense transaction with negative amount", () => {
    const existing = [
      makeTxn({ id: "exp-1", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "exp-1",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-04-02",
      merchant: "New Store",
      note: "",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].amount).toBe(-7500);
    expect(result[0].type).toBe("expense");
  });

  it("does not modify other transactions", () => {
    const other = makeTxn({ id: "other" });
    const target = makeTxn({ id: "target", type: "income", amount: 1000 });
    const input: TransactionFormData = {
      id: "target",
      type: "income",
      amount: 2000,
      categoryId: "cat-1",
      accountId: "acc-1",
      date: "2026-04-01",
      merchant: "M",
      note: "",
    };

    const result = updateTransaction(input, [other, target]);
    expect(result[0]).toBe(other);
    expect(result[1].amount).toBe(2000);
  });

  it("preserves original time when date is unchanged", () => {
    const existing = [
      makeTxn({ id: "txn-keep-time", datetime: "2026-01-15T21:30:45.123", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "txn-keep-time",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-01-15", // same date as original
      merchant: "Updated Store",
      note: "updated",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].datetime).toBe("2026-01-15T21:30:45.123");
  });

  it("generates new time when date changes", () => {
    const existing = [
      makeTxn({ id: "txn-new-time", datetime: "2026-01-15T21:30:45.123", type: "expense", amount: -5000 }),
    ];
    const input: TransactionFormData = {
      id: "txn-new-time",
      type: "expense",
      amount: 7500,
      categoryId: "cat-food",
      accountId: "acc-1",
      date: "2026-01-20", // different date
      merchant: "Updated Store",
      note: "updated",
    };

    const result = updateTransaction(input, existing);
    expect(result[0].datetime).toMatch(/^2026-01-20T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(result[0].datetime).not.toBe("2026-01-15T21:30:45.123");
  });

  // The non-transfer fxRate is applied verbatim from input, exactly as on create
  // — the caller resolves the rate for the (possibly changed) account. Moving a
  // transaction to a different-currency account therefore re-rates it correctly,
  // and a default-currency target clears the stamp. (Regression: the old code
  // spread the stale txn and never wrote input.fxRate, mis-converting moves 1:1.)
  describe("non-transfer fxRate re-stamping", () => {
    it("re-stamps when moved to a different-currency account", () => {
      // A ₽-default expense (no stamp) moved to a USD account, the caller
      // resolving USD's rate (90 ₽/USD) and passing it.
      const existing = [
        makeTxn({ id: "exp-move", type: "expense", amount: -5000, accountId: "acc-rub", fxRate: undefined }),
      ];
      const input: TransactionFormData = {
        id: "exp-move",
        type: "expense",
        amount: 5000,
        categoryId: "cat-food",
        accountId: "acc-usd",
        date: "2026-06-01",
        merchant: "",
        note: "",
        fxRate: 90,
      };
      const result = updateTransaction(input, existing);
      expect(result[0].accountId).toBe("acc-usd");
      expect(result[0].fxRate).toBe(90);
    });

    it("clears the stamp when moved to a default-currency account", () => {
      // A USD-stamped expense moved back to the ₽ default — caller passes none.
      const existing = [
        makeTxn({ id: "exp-back", type: "expense", amount: -5000, accountId: "acc-usd", fxRate: 90 }),
      ];
      const input: TransactionFormData = {
        id: "exp-back",
        type: "expense",
        amount: 5000,
        categoryId: "cat-food",
        accountId: "acc-rub",
        date: "2026-06-01",
        merchant: "",
        note: "",
        fxRate: undefined,
      };
      const result = updateTransaction(input, existing);
      expect(result[0].accountId).toBe("acc-rub");
      expect(result[0].fxRate).toBeUndefined();
    });

    it("preserves a stamp the caller carries through an in-place edit", () => {
      // Editing amount on a foreign txn that stays on its account: the caller
      // re-passes the same stamp, so it survives.
      const existing = [
        makeTxn({ id: "exp-edit", type: "expense", amount: -5000, accountId: "acc-usd", fxRate: 90 }),
      ];
      const input: TransactionFormData = {
        id: "exp-edit",
        type: "expense",
        amount: 7500,
        categoryId: "cat-food",
        accountId: "acc-usd",
        date: "2026-06-01",
        merchant: "",
        note: "",
        fxRate: 90,
      };
      const result = updateTransaction(input, existing);
      expect(result[0].amount).toBe(-7500);
      expect(result[0].fxRate).toBe(90);
    });
  });

  describe("transfer update", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      accountId: "acc-checking",
      transferPairId: "tf-to",
      merchant: "",
      categoryId: "",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      accountId: "acc-savings",
      transferPairId: "tf-from",
      merchant: "",
      categoryId: "",
    });

    it("updates both legs of a transfer", () => {
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 30000,
        categoryId: "",
        accountId: "acc-new-from",
        toAccountId: "acc-new-to",
        date: "2026-05-01",
        merchant: "",
        note: "updated note",
      };

      const result = updateTransaction(input, [fromLeg, toLeg]);
      expect(result).toHaveLength(2);

      const updatedFrom = result.find((t) => t.id === "tf-from")!;
      const updatedTo = result.find((t) => t.id === "tf-to")!;

      expect(updatedFrom.amount).toBe(-30000);
      expect(updatedFrom.accountId).toBe("acc-new-from");
      expect(updatedFrom.note).toBe("updated note");
      expect(updatedFrom.datetime).toMatch(/^2026-05-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);

      expect(updatedTo.amount).toBe(30000);
      expect(updatedTo.accountId).toBe("acc-new-to");
      expect(updatedTo.note).toBe("updated note");
      expect(updatedTo.datetime).toMatch(/^2026-05-01T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("preserves original time on both legs when date is unchanged", () => {
      const fromLegSameDate = makeTxn({
        id: "tf-from",
        type: "transfer",
        amount: -25000,
        accountId: "acc-checking",
        transferPairId: "tf-to",
        merchant: "",
        categoryId: "",
        datetime: "2026-01-15T21:30:45.123",
      });
      const toLegSameDate = makeTxn({
        id: "tf-to",
        type: "transfer",
        amount: 25000,
        accountId: "acc-savings",
        transferPairId: "tf-from",
        merchant: "",
        categoryId: "",
        datetime: "2026-01-15T21:30:45.123",
      });
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 30000,
        categoryId: "",
        accountId: "acc-checking",
        toAccountId: "acc-savings",
        date: "2026-01-15", // same date
        merchant: "",
        note: "updated",
      };

      const result = updateTransaction(input, [fromLegSameDate, toLegSameDate]);
      expect(result.find((t) => t.id === "tf-from")!.datetime).toBe("2026-01-15T21:30:45.123");
      expect(result.find((t) => t.id === "tf-to")!.datetime).toBe("2026-01-15T21:30:45.123");
    });

    it("clears merchant on both transfer legs", () => {
      const input: TransactionFormData = {
        id: "tf-from",
        type: "transfer",
        amount: 25000,
        categoryId: "",
        accountId: "acc-checking",
        toAccountId: "acc-savings",
        date: "2026-05-01",
        merchant: "should be ignored",
        note: "",
      };

      const result = updateTransaction(input, [fromLeg, toLeg]);
      expect(result[0].merchant).toBe("");
      expect(result[1].merchant).toBe("");
    });

    it("round-trips a cross-currency transfer: independent amounts and re-stamped rates", () => {
      const crossFrom = makeTxn({
        id: "xc-from", type: "transfer", amount: -10000, accountId: "acc-usd",
        transferPairId: "xc-to", merchant: "", categoryId: "", fxRate: undefined,
      });
      const crossTo = makeTxn({
        id: "xc-to", type: "transfer", amount: 9200, accountId: "acc-eur",
        transferPairId: "xc-from", merchant: "", categoryId: "", fxRate: 10000 / 9200,
      });
      // Edit both amounts: $120 → €110, new derived rate 12000/11000.
      const input: TransactionFormData = {
        id: "xc-from", type: "transfer", amount: 12000, categoryId: "",
        accountId: "acc-usd", toAccountId: "acc-eur", date: "2026-05-01",
        merchant: "", note: "", toAmount: 11000, fxRate: undefined, toFxRate: 12000 / 11000,
      };

      const result = updateTransaction(input, [crossFrom, crossTo]);
      const from = result.find((t) => t.id === "xc-from")!;
      const to = result.find((t) => t.id === "xc-to")!;
      expect(from.amount).toBe(-12000);
      expect(from.fxRate).toBeUndefined();
      expect(to.amount).toBe(11000);
      expect(to.fxRate).toBeCloseTo(12000 / 11000, 12);
      // Still nets to ~0 at the re-stamped rates.
      expect(from.amount * (from.fxRate ?? 1) + to.amount * (to.fxRate ?? 1)).toBeCloseTo(0, 6);
    });

    it("rewrites both legs of a same-currency transfer from canonical input (to mirrors from, shares rate)", () => {
      // Both legs USD; the form sends one amount, no toAmount/toFxRate, so the
      // to leg mirrors the from leg and both carry the one stamped rate.
      const usdFrom = makeTxn({
        id: "us-from", type: "transfer", amount: -10000, accountId: "acc-usd-a",
        transferPairId: "us-to", merchant: "", categoryId: "", fxRate: 90,
      });
      const usdTo = makeTxn({
        id: "us-to", type: "transfer", amount: 10000, accountId: "acc-usd-b",
        transferPairId: "us-from", merchant: "", categoryId: "", fxRate: 90,
      });
      const input: TransactionFormData = {
        id: "us-from", type: "transfer", amount: 15000, categoryId: "",
        accountId: "acc-usd-a", toAccountId: "acc-usd-b", date: "2026-06-01",
        merchant: "", note: "", fxRate: 90, // toAmount/toFxRate absent → mirror
      };
      const result = updateTransaction(input, [usdFrom, usdTo]);
      const from = result.find((t) => t.id === "us-from")!;
      const to = result.find((t) => t.id === "us-to")!;
      expect(from.amount).toBe(-15000);
      expect(to.amount).toBe(15000);
      expect(from.fxRate).toBe(90);
      expect(to.fxRate).toBe(90);
    });

    // Vlad's settle-at-a-different-rate case. A RUB(default) → IDR transfer that
    // settled for a different IDR amount than first recorded. The form's
    // canonical input edits ONLY the IDR inflow leg (toAmount + toFxRate); the
    // RUB from-leg amount and its (empty) rate are pinned. This proves the core
    // is sound — the corruption Vlad hit was the FORM passing the inflow as the
    // from `amount`, fixed in a different unit, not here.
    it("editing only the IDR inflow leaves the RUB from-leg amount untouched", () => {
      const RUB_OUT = 1_000_000; // 10,000 ₽ in cents — fixed across the edit
      const IDR_OLD = 175_800_000; // 1,758,000 IDR
      const IDR_NEW = 180_000_000; // 1,800,000 IDR actually landed
      const rubFrom = makeTxn({
        id: "ri-from", type: "transfer", amount: -RUB_OUT, accountId: "acc-rub",
        transferPairId: "ri-to", merchant: "", categoryId: "", fxRate: undefined,
      });
      const idrTo = makeTxn({
        id: "ri-to", type: "transfer", amount: IDR_OLD, accountId: "acc-idr",
        transferPairId: "ri-from", merchant: "", categoryId: "",
        fxRate: RUB_OUT / IDR_OLD,
      });
      // Canonical edit: same RUB out, new IDR in, the IDR leg's rate re-derived.
      const input: TransactionFormData = {
        id: "ri-from", type: "transfer", amount: RUB_OUT, categoryId: "",
        accountId: "acc-rub", toAccountId: "acc-idr", date: "2026-06-01",
        merchant: "", note: "", toAmount: IDR_NEW,
        fxRate: undefined, toFxRate: RUB_OUT / IDR_NEW,
      };
      const result = updateTransaction(input, [rubFrom, idrTo]);
      const from = result.find((t) => t.id === "ri-from")!;
      const to = result.find((t) => t.id === "ri-to")!;

      // The RUB from-leg is unchanged: same amount, still no stamp.
      expect(from.amount).toBe(-RUB_OUT);
      expect(from.fxRate).toBeUndefined();
      // Only the IDR leg moved — new amount and new derived rate.
      expect(to.amount).toBe(IDR_NEW);
      expect(to.fxRate).toBe(RUB_OUT / IDR_NEW);
      // Still nets to exactly 0 ₽ at the re-stamped rates.
      expect(from.amount * (from.fxRate ?? 1) + to.amount * (to.fxRate ?? 1)).toBe(0);
    });
  });
});

describe("deleteTransaction", () => {
  it("removes a single income transaction", () => {
    const income = makeTxn({ id: "inc-1", type: "income", amount: 10000 });
    const other = makeTxn({ id: "other" });
    const result = deleteTransaction(income, [income, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });

  it("removes a single expense transaction", () => {
    const expense = makeTxn({ id: "exp-1", type: "expense", amount: -5000 });
    const result = deleteTransaction(expense, [expense]);
    expect(result).toHaveLength(0);
  });

  it("removes both legs of a transfer", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      transferPairId: "tf-to",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      transferPairId: "tf-from",
    });
    const other = makeTxn({ id: "other" });

    const result = deleteTransaction(fromLeg, [fromLeg, toLeg, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });

  it("removes both legs when deleting the to-leg of a transfer", () => {
    const fromLeg = makeTxn({
      id: "tf-from",
      type: "transfer",
      amount: -25000,
      transferPairId: "tf-to",
    });
    const toLeg = makeTxn({
      id: "tf-to",
      type: "transfer",
      amount: 25000,
      transferPairId: "tf-from",
    });

    const result = deleteTransaction(toLeg, [fromLeg, toLeg]);
    expect(result).toHaveLength(0);
  });

  it("only removes the target when transfer has no transferPairId", () => {
    const orphanTransfer = makeTxn({
      id: "tf-orphan",
      type: "transfer",
      amount: -5000,
      transferPairId: "",
    });
    const other = makeTxn({ id: "other" });

    const result = deleteTransaction(orphanTransfer, [orphanTransfer, other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("other");
  });
});
