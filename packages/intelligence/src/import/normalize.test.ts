import { describe, it, expect } from "vitest";
import { getToday } from "@capybudget/core";
import { countStreamedRows, normalizeCsv, normalizeImage, isImageOrPdf, normalizeMapping } from "./normalize";
import type { NormalizeProgress } from "./events";
import { CSV_MAPPING_SCHEMA, EXTRACTION_SCHEMA } from "./schemas";
import { SchemaValidationError } from "../structured";
import type { JsonSchema } from "../structured";
import { MockStructuredSession } from "./test-doubles";

/** Walk every node of a schema (properties, items, anyOf), yielding each. */
function* walkSchema(schema: JsonSchema): Generator<JsonSchema> {
  yield schema;
  for (const sub of schema.anyOf ?? []) yield* walkSchema(sub);
  if (schema.items) yield* walkSchema(schema.items);
  for (const prop of Object.values(schema.properties ?? {})) yield* walkSchema(prop);
}

describe("CSV_MAPPING_SCHEMA", () => {
  it("sets additionalProperties:false on every object node (Anthropic output_config requirement)", () => {
    for (const node of walkSchema(CSV_MAPPING_SCHEMA)) {
      if (node.type === "object") {
        expect(node.additionalProperties, JSON.stringify(node)).toBe(false);
        expect(node.properties, JSON.stringify(node)).toBeDefined();
      }
    }
  });

  it("carries no enum anywhere — off-vocabulary values stay tolerated", () => {
    for (const node of walkSchema(CSV_MAPPING_SCHEMA)) {
      expect(node.enum).toBeUndefined();
    }
  });

  it("requires only amount at the top level", () => {
    expect(CSV_MAPPING_SCHEMA.required).toEqual(["amount"]);
  });

  it("does not describe an open-keyed typeMap", () => {
    const typeDetection = CSV_MAPPING_SCHEMA.properties?.typeDetection;
    expect(typeDetection?.properties?.typeMap).toBeUndefined();
  });
});

const MAPPING = {
  date: { column: "Date", format: "YYYY-MM-DD" },
  description: { column: "Description" },
  amount: { style: "single", column: "Amount", sign: "negative_expense" },
  amountFormat: { format: "plain" },
  typeDetection: { method: "amount_sign" },
  sourceAccount: { literal: "Checking" },
  sourceCategory: null,
};

describe("normalizeCsv", () => {
  it("maps once and transforms every row into staged transactions", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,SALARY,2000.00";
    const session = new MockStructuredSession([() => MAPPING]);

    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].schema).toBe(CSV_MAPPING_SCHEMA);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "imp-1", date: "2026-01-05", amount: -450, type: "expense" });
    expect(rows[1]).toMatchObject({ id: "imp-2", amount: 200000, type: "income" });
  });

  it("re-calls the mapper once when a preview surfaces transform errors", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const badMapping = { ...MAPPING, date: { column: "Posted", format: "YYYY-MM-DD" } }; // column not in CSV → per-row error
    const session = new MockStructuredSession([() => badMapping, () => MAPPING]);

    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(2);
    // The corrective call carries the prior errors.
    expect(JSON.stringify(session.calls[1].messages)).toContain("transform error");
    expect(rows).toHaveLength(1);
  });

  it("does not re-call when the first mapping is clean", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const session = new MockStructuredSession([() => MAPPING]);
    await normalizeCsv(session, { name: "f.csv", content: csv });
    expect(session.calls).toHaveLength(1);
  });

  it("reports the data-row count as the progress total before the mapping call", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,SALARY,2000.00";
    const ticks: NormalizeProgress[] = [];
    const session = new MockStructuredSession([
      () => {
        // The denominator must already be known while the slow call runs.
        expect(ticks).toEqual([{ rows: 0, total: 2 }]);
        return MAPPING;
      },
    ]);

    await normalizeCsv(session, { name: "f.csv", content: csv }, { onProgress: (p) => ticks.push(p) });

    expect(ticks).toEqual([{ rows: 0, total: 2 }]);
  });

  it("completes omitted metadata from the data and transforms without a retry", async () => {
    // The model returns only the column roles — no amountFormat, typeDetection,
    // sourceAccount, or date.format. normalizeMapping infers them; no re-call.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,SALARY,2000.00";
    const rolesOnly = {
      date: { column: "Date" },
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    };
    const session = new MockStructuredSession([() => rolesOnly]);

    const { rows, mapping } = await normalizeCsv(session, { name: "checking.csv", content: csv });

    expect(session.calls).toHaveLength(1); // no retry — metadata is inferred, not demanded
    expect(mapping.date).toMatchObject({ column: "Date", format: "YYYY-MM-DD" });
    expect(mapping.amountFormat.format).toBe("plain");
    expect(mapping.typeDetection).toEqual({ method: "amount_sign" });
    expect(mapping.sourceAccount).toEqual({ literal: "checking" });
    expect(mapping.sourceCategory).toBeNull();
    expect(rows[0]).toMatchObject({ amount: -450, type: "expense" });
    expect(rows[1]).toMatchObject({ amount: 200000, type: "income" });
  });

  it("succeeds when the model phrases amountFormat outside our vocabulary", async () => {
    // The reported third failure: amountFormat returned off-enum. It's advisory
    // now — code infers the format from the data and ignores the model's value.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const offEnum = { ...MAPPING, amountFormat: { format: "usd" } };
    const session = new MockStructuredSession([() => offEnum]);

    const { rows, mapping } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(1); // no rejection, no retry
    expect(mapping.amountFormat.format).toBe("plain"); // inferred from the data
    expect(rows).toHaveLength(1);
  });

  it("coerces off-vocabulary typeDetection.method and amount.sign", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,SALARY,2000.00";
    const off = {
      ...MAPPING,
      typeDetection: { method: "guess_from_sign" },
      amount: { style: "single", column: "Amount", sign: "expenses_are_negative" },
    };
    const session = new MockStructuredSession([() => off]);

    const { rows, mapping } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(1);
    expect(mapping.typeDetection).toEqual({ method: "amount_sign" });
    expect(mapping.amount).toMatchObject({ sign: "negative_expense" });
    expect(rows[0]).toMatchObject({ amount: -450, type: "expense" });
    expect(rows[1]).toMatchObject({ type: "income" });
  });

  it("tolerates an unexpected extra key the model adds", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const withExtra = { ...MAPPING, confidence: "high", notes: "looks like a bank export" };
    const session = new MockStructuredSession([() => withExtra]);

    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it("surfaces an error when no amount column exists at all, even after the retry", async () => {
    // No numeric column anywhere → not a transaction file. Auto-detect can't
    // recover it, so it throws after one corrective retry rather than masking.
    const csv = "Date,Memo\n2026-01-05,COFFEE\n2026-01-06,LUNCH";
    const noAmount = { date: { column: "Date" }, description: { column: "Memo" }, amount: {} };
    const session = new MockStructuredSession([() => noAmount, () => noAmount]);

    await expect(normalizeCsv(session, { name: "f.csv", content: csv })).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(session.calls).toHaveLength(2);
  });

  it("imports a CSV with no date column, dating every row to the import date", async () => {
    const csv = "Description,Amount\nCOFFEE,-4.50\nSALARY,2000.00";
    const mapping = {
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    };
    const session = new MockStructuredSession([() => mapping]);

    const { rows, mapping: resolved } = await normalizeCsv(
      session,
      { name: "f.csv", content: csv },
      { importDate: "2026-06-07" },
    );

    expect(session.calls).toHaveLength(1); // no throw, no retry
    expect(resolved.date).toEqual({ literal: "2026-06-07" });
    expect(rows.map((r) => r.date)).toEqual(["2026-06-07", "2026-06-07"]);
    expect(rows[0]).toMatchObject({ amount: -450, type: "expense" });
  });

  it("imports with empty descriptions when there is no description column", async () => {
    const csv = "Date,Amount\n2026-01-05,-4.50";
    const mapping = {
      date: { column: "Date" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    };
    const session = new MockStructuredSession([() => mapping]);

    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(session.calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("");
  });

  it("returns the transform errors for rows that don't parse (not silently dropped)", async () => {
    // Row 2's date can't parse under any valid mapping, so it survives the
    // preview re-call and errors in the final transform. The errors must come
    // back so the orchestrator can warn instead of letting the row vanish.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\nNOTADATE,BROKEN,-1.00";
    const session = new MockStructuredSession([() => MAPPING, () => MAPPING]);

    const { rows, errors } = await normalizeCsv(session, { name: "f.csv", content: csv });

    expect(rows).toHaveLength(1); // only COFFEE transforms
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(2);
    expect(errors[0].message).toContain("NOTADATE");
  });

  it("maps an Apple-Card-style positive=expense statement correctly", async () => {
    // Apple Card convention: positive purchases are expenses, the negative row
    // is a payment toward the card (a transfer). The model returns
    // positive_expense plus a transfer pattern; the column has a negative, but
    // the model's sign must win over the data heuristic.
    const csv =
      "Date,Description,Amount\n2026-01-05,APPLE STORE,49.99\n2026-01-06,GROCERIES,82.10\n2026-01-10,ACH Payment - Bank,-200.00";
    const appleCardMapping = {
      date: { column: "Date" },
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "positive_expense" },
      typeDetection: { method: "rules", transferPatterns: ["Payment"] },
    };
    const session = new MockStructuredSession([() => appleCardMapping]);

    const { rows, mapping } = await normalizeCsv(session, { name: "apple-card.csv", content: csv });

    expect(session.calls).toHaveLength(1); // no retry — clean mapping
    expect(mapping.amount).toMatchObject({ sign: "positive_expense" });
    expect(rows[0]).toMatchObject({ description: "APPLE STORE", amount: -4999, type: "expense" });
    expect(rows[1]).toMatchObject({ description: "GROCERIES", amount: -8210, type: "expense" });
    expect(rows[2]).toMatchObject({ amount: 20000, type: "transfer" });
  });

  it("continues ids from startId for multi-file appends", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const session = new MockStructuredSession([() => MAPPING]);
    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv }, { startId: 10 });
    expect(rows[0].id).toBe("imp-10");
  });

  describe("mapping sample diversity", () => {
    /** A CSV whose row i carries the unique marker "MERCHANT i". */
    function csvOf(amounts: number[]): string {
      const lines = ["Date,Description,Amount"];
      amounts.forEach((amount, i) => {
        lines.push(`2026-01-${String((i % 28) + 1).padStart(2, "0")},MERCHANT ${i},${amount.toFixed(2)}`);
      });
      return lines.join("\n");
    }

    /** The prompt's "Sample rows" JSON block (the raw-row head listing above it
     *  always shows the first HEADER_SCAN_ROWS rows and would alias markers). */
    function sampleBlock(session: MockStructuredSession): string {
      const content = session.calls[0].messages[0].content as string;
      return content.slice(content.indexOf("Sample rows"));
    }

    it("samples the head plus rows spread to the end of a long table", async () => {
      // 60 rows — a head-only sample would never show the model anything past
      // row 19, hiding the monthly payment/transfer rows. The spread half must
      // reach the last row; rows just past the head are the ones traded away.
      const csv = csvOf(Array.from({ length: 60 }, () => -5));
      const session = new MockStructuredSession([() => MAPPING]);
      await normalizeCsv(session, { name: "f.csv", content: csv });

      const sample = sampleBlock(session);
      expect(sample).toContain('"MERCHANT 0"');
      expect(sample).toContain('"MERCHANT 9"');
      expect(sample).toContain('"MERCHANT 59"');
      expect(sample).not.toContain('"MERCHANT 10"');
    });

    it("is deterministic — the same file always yields the same prompt", async () => {
      const csv = csvOf(Array.from({ length: 47 }, () => -5));
      const a = new MockStructuredSession([() => MAPPING]);
      const b = new MockStructuredSession([() => MAPPING]);
      await normalizeCsv(a, { name: "f.csv", content: csv });
      await normalizeCsv(b, { name: "f.csv", content: csv });
      expect(JSON.stringify(a.calls[0].messages)).toBe(JSON.stringify(b.calls[0].messages));
    });

    it("a short table is passed whole, in order", async () => {
      const csv = csvOf([-1, -2, -3, -4, -5]);
      const session = new MockStructuredSession([() => MAPPING]);
      await normalizeCsv(session, { name: "f.csv", content: csv });

      const sample = sampleBlock(session);
      for (let i = 0; i < 5; i++) expect(sample).toContain(`"MERCHANT ${i}"`);
      expect(sample.indexOf('"MERCHANT 0"')).toBeLessThan(sample.indexOf('"MERCHANT 4"'));
    });

    it("the data heuristics read the diversified sample (sign inferred from a late negative)", async () => {
      // All-positive head, negatives only in the back half — the shape of a
      // statement whose payments cluster late. With no model-supplied sign, the
      // heuristic must see a spread row to land on negative_expense.
      const csv = csvOf(Array.from({ length: 60 }, (_, i) => (i < 40 ? 5 : -5)));
      const rolesOnly = {
        date: { column: "Date" },
        description: { column: "Description" },
        amount: { style: "single", column: "Amount" },
      };
      const session = new MockStructuredSession([() => rolesOnly]);

      const { mapping } = await normalizeCsv(session, { name: "f.csv", content: csv });

      expect(mapping.amount).toMatchObject({ sign: "negative_expense" });
    });
  });

  describe("header row location", () => {
    // A BofA-shaped export: a summary preamble, a blank line, then the real
    // table whose first row is a zero-amount balance marker. Parsed naively,
    // the preamble head becomes the header and the real description column
    // gets an empty-string name.
    const BOFA_CSV = [
      "Description,,Summary Amt.",
      'Beginning balance as of 02/03/2026,,"1,131.74"',
      'Total credits,,"68,979.42"',
      'Total debits,,"-64,737.00"',
      'Ending balance as of 06/08/2026,,"5,374.16"',
      "",
      "Date,Description,Amount,Running Bal.",
      '02/03/2026,"Beginning balance as of 02/03/2026",,"1,131.74"',
      '02/05/2026,"PAYPAL DES:INST XFER ID:COFFEE","-120.54","1,011.20"',
      '02/06/2026,"Zelle payment from ALICE","2,500.00","3,511.20"',
      '02/07/2026,"GROCERY OUTLET 0042","-45.10","3,466.10"',
    ].join("\n");

    const BOFA_MAPPING = {
      date: { column: "Date" },
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
      skipRules: [{ column: "Description", contains: "Beginning balance" }],
    };

    it("locates the real header past a bank summary preamble", async () => {
      const session = new MockStructuredSession([() => BOFA_MAPPING]);

      const { rows, mapping } = await normalizeCsv(session, { name: "stmt.csv", content: BOFA_CSV });

      expect(session.calls).toHaveLength(1);
      expect(mapping.headerRow).toBe(5); // blank line stripped, so the header is parsed row 5
      expect(rows).toHaveLength(3); // balance marker skipped by the mapping's skipRule
      expect(rows[0]).toMatchObject({ date: "2026-02-05", amount: -12054, type: "expense" });
      expect(rows[1]).toMatchObject({ date: "2026-02-06", amount: 250000, type: "income" });
      expect(rows.map((r) => r.description)).toEqual([
        "PAYPAL DES:INST XFER ID:COFFEE",
        "Zelle payment from ALICE",
        "GROCERY OUTLET 0042",
      ]);
    });

    it("shows the mapper the indexed raw rows so headerRow stays addressable", async () => {
      const session = new MockStructuredSession([() => BOFA_MAPPING]);
      await normalizeCsv(session, { name: "stmt.csv", content: BOFA_CSV });
      const prompt = JSON.stringify(session.calls[0].messages);
      expect(prompt).toContain("headerRow");
      expect(prompt).toContain("reads row 5 as the table header");
    });

    it("renames blank header cells positionally so every column is addressable", async () => {
      const csv = "Date,,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,BAGEL,-3.25";
      const mapping = {
        date: { column: "Date" },
        description: { column: "Column 2" },
        amount: { style: "single", column: "Amount", sign: "negative_expense" },
      };
      const session = new MockStructuredSession([() => mapping]);

      const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv });

      expect(session.calls).toHaveLength(1); // "Column 2" resolves — no preview error
      expect(JSON.stringify(session.calls[0].messages)).toContain("Column 2"); // the mapper sees the renamed key
      expect(rows.map((r) => r.description)).toEqual(["COFFEE", "BAGEL"]);
    });

    it("honors a model headerRow override when detection cannot tell", async () => {
      // A metadata preamble with the same width as the table and no dated rows
      // below it until the real data — the consistency scan picks row 0; the
      // model relocates the header.
      const csv = [
        "Account,Number,Period,Currency",
        "My Checking,1234,Feb 2026,USD",
        "Statement,period,February,2026",
        "Posted,Description,Amount,Balance",
        "2026-02-05,COFFEE,-4.50,995.50",
        "2026-02-06,SALARY,2000.00,2995.50",
      ].join("\n");
      const session = new MockStructuredSession([
        () => ({
          headerRow: 3,
          date: { column: "Posted" },
          description: { column: "Description" },
          amount: { style: "single", column: "Amount", sign: "negative_expense" },
        }),
      ]);

      const { rows, mapping } = await normalizeCsv(session, { name: "f.csv", content: csv });

      expect(session.calls).toHaveLength(1);
      expect(mapping.headerRow).toBe(3);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ date: "2026-02-05", description: "COFFEE", amount: -450 });
      expect(rows[1]).toMatchObject({ description: "SALARY", amount: 200000, type: "income" });
    });

    it("rejects a nonsense headerRow and falls back to the detected pick", async () => {
      const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
      const session = new MockStructuredSession([() => ({ ...MAPPING, headerRow: 9999 })]);

      const { rows, mapping } = await normalizeCsv(session, { name: "f.csv", content: csv });

      expect(session.calls).toHaveLength(1);
      expect(mapping.headerRow).toBe(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ description: "COFFEE", amount: -450 });
    });
  });
});

describe("normalizeMapping", () => {
  const IMPORT_DATE = "2026-06-07";
  const ROLES = {
    date: { column: "Date" },
    description: { column: "Description" },
    amount: { style: "single", column: "Amount", sign: "negative_expense" },
  };
  const sampleWith = (overrides: Record<string, string>) => [{ Date: "2026-01-01", Description: "X", Amount: "1", ...overrides }];

  /** Narrow the `date` union to its column form (most cases produce one). */
  const columnDate = (date: { column: string; format: string } | { literal: string }) => {
    if ("literal" in date) throw new Error(`expected a column date, got literal ${date.literal}`);
    return date;
  };

  it("fills every omitted metadata field, defaulting sourceCategory to null", () => {
    const m = normalizeMapping(ROLES, sampleWith({ Date: "2026-01-05", Amount: "-4.50" }), "wells-fargo_2026.csv", IMPORT_DATE);
    expect(columnDate(m.date).format).toBe("YYYY-MM-DD");
    expect(m.amountFormat.format).toBe("plain");
    expect(m.typeDetection).toEqual({ method: "amount_sign" });
    expect(m.sourceAccount).toEqual({ literal: "wells fargo 2026" });
    expect(m.sourceCategory).toBeNull();
  });

  it("keeps a valid model-provided date.format over inference", () => {
    const m = normalizeMapping(
      { ...ROLES, date: { column: "Date", format: "DD/MM/YYYY" } },
      sampleWith({ Date: "01/05/2026" }),
      "f.csv",
      IMPORT_DATE,
    );
    expect(columnDate(m.date).format).toBe("DD/MM/YYYY");
  });

  it("ignores an unsupported model-provided date.format and infers instead", () => {
    const m = normalizeMapping(
      { ...ROLES, date: { column: "Date", format: "the fifth of january" } },
      sampleWith({ Date: "2026-01-05" }),
      "f.csv",
      IMPORT_DATE,
    );
    expect(columnDate(m.date).format).toBe("YYYY-MM-DD");
  });

  it("auto-detects a date column when the model named none", () => {
    const m = normalizeMapping(
      { description: { column: "Memo" }, amount: { column: "Amt", sign: "negative_expense" } },
      [{ Posted: "2026-01-05", Memo: "X", Amt: "-1.00" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(columnDate(m.date)).toEqual({ column: "Posted", format: "YYYY-MM-DD" });
  });

  it("falls back to the import date when no date column exists", () => {
    const m = normalizeMapping(
      { description: { column: "Memo" }, amount: { column: "Amt", sign: "negative_expense" } },
      [{ Memo: "X", Amt: "-1.00" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(m.date).toEqual({ literal: IMPORT_DATE });
  });

  it("defaults description to empty when the model named no description column", () => {
    const m = normalizeMapping(
      { amount: { column: "Amt", sign: "negative_expense" } },
      [{ Memo: "X", Amt: "-1.00" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(m.description).toEqual({ columns: [], separator: " " });
  });

  it("throws only when no amount column can be identified", () => {
    expect(() =>
      normalizeMapping({ amount: {} }, [{ Memo: "X", Note: "Y" }], "f.csv", IMPORT_DATE),
    ).toThrow(SchemaValidationError);
  });

  it("auto-detects an amount column when the model named none", () => {
    const m = normalizeMapping(
      { date: { column: "Date" }, description: { column: "Memo" } },
      [{ Date: "2026-01-05", Memo: "X", Total: "-12.50" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(m.amount).toMatchObject({ style: "single", column: "Total" });
  });

  it("reads bare-string column refs", () => {
    const m = normalizeMapping(
      { date: "Date", description: "Memo", amount: { column: "Amt", sign: "negative_expense" } },
      [{ Date: "2026-01-05", Memo: "X", Amt: "-1.00" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(columnDate(m.date).column).toBe("Date");
    expect(m.description).toEqual({ column: "Memo" });
    expect(m.amount).toMatchObject({ style: "single", column: "Amt" });
  });

  it("recognizes split debit/credit columns by synonym keys", () => {
    const m = normalizeMapping(
      { date: { column: "Date" }, description: { column: "Memo" }, amount: { debit: "Outflow", credit: "Inflow" } },
      [{ Date: "2026-01-05", Memo: "X", Outflow: "10.00", Inflow: "" }],
      "f.csv",
      IMPORT_DATE,
    );
    expect(m.amount).toEqual({ style: "split", expenseColumn: "Outflow", incomeColumn: "Inflow" });
  });

  describe("sign", () => {
    const sign = (rawSign: unknown, amountValue: string) =>
      (normalizeMapping(
        { date: { column: "Date" }, description: { column: "Memo" }, amount: { column: "Amount", sign: rawSign } },
        [{ Date: "2026-01-05", Memo: "X", Amount: amountValue }],
        "f.csv",
        IMPORT_DATE,
      ).amount as { sign: string }).sign;

    it("maps recognizable phrasings", () => {
      expect(sign("expenses_are_negative", "-1")).toBe("negative_expense");
      expect(sign("charges positive", "1")).toBe("positive_expense");
      expect(sign("positive_expense", "5")).toBe("positive_expense");
      expect(sign("debits_negative", "-5")).toBe("negative_expense");
    });
    it("honors the model's sign even when the data would guess otherwise", () => {
      // Apple Card: purchases positive = expense, but the column also has
      // negatives (card payments). The data heuristic would see negatives and
      // pick negative_expense; the model's positive_expense must win.
      expect(sign("positive_expense", "-100.00")).toBe("positive_expense");
      expect(sign("charges_are_positive", "-100.00")).toBe("positive_expense");
    });
    it("infers from the data only when the model gave no usable sign", () => {
      expect(sign(undefined, "-4.50")).toBe("negative_expense"); // negatives present
      expect(sign("???", "2.99")).toBe("positive_expense"); // unparseable → data: all-positive
    });
  });

  describe("amountFormat inference", () => {
    const fmt = (amount: string) => normalizeMapping(ROLES, sampleWith({ Amount: amount }), "f.csv", IMPORT_DATE).amountFormat.format;
    it("currency for a symbol or thousands grouping", () => {
      expect(fmt("$1,234.56")).toBe("currency");
      expect(fmt("1,234.56")).toBe("currency");
      expect(fmt("($50.00)")).toBe("currency");
    });
    it("european for a comma decimal", () => {
      expect(fmt("1.234,56")).toBe("european");
      expect(fmt("1234,56")).toBe("european");
    });
    it("plain otherwise", () => {
      expect(fmt("-4.50")).toBe("plain");
      expect(fmt("1234.56")).toBe("plain");
    });
  });

  describe("date.format inference", () => {
    const df = (date: string) => columnDate(normalizeMapping(ROLES, sampleWith({ Date: date }), "f.csv", IMPORT_DATE).date).format;
    it("ISO and dotted forms", () => {
      expect(df("2026-01-05")).toBe("YYYY-MM-DD");
      expect(df("2026/01/05")).toBe("YYYY/MM/DD");
      expect(df("25.01.2026")).toBe("DD.MM.YYYY");
    });
    it("defaults ambiguous slash dates to US MM/DD/YYYY", () => {
      expect(df("01/05/2026")).toBe("MM/DD/YYYY");
    });
    it("picks DD/MM when a first component exceeds 12", () => {
      expect(df("13/05/2026")).toBe("DD/MM/YYYY");
    });
    it("picks MM/DD when a second component exceeds 12", () => {
      expect(df("05/13/2026")).toBe("MM/DD/YYYY");
    });
  });
});

describe("normalizeImage", () => {
  it("unwraps the result envelope, extracts rows, and feeds them through buildStaged", async () => {
    const session = new MockStructuredSession([
      () => ({
        result: {
          count: 1,
          rows: [
            { date: "2026-01-05", amount: -1599, type: "expense", description: "Netflix", sourceAccount: "Visa", sourceCategory: "Entertainment" },
          ],
        },
      }),
    ]);

    const { rows, noData } = await normalizeImage(session, { name: "r.png", content: "B64", mediaType: "image/png" });

    expect(noData).toBeUndefined();
    expect(session.calls[0].schema).toBe(EXTRACTION_SCHEMA);
    expect(rows[0]).toMatchObject({ id: "imp-1", description: "Netflix", merchant: "", categoryId: "" });
    expect(rows[0].sourceCategory).toBe("Entertainment");
  });

  it("coerces an unparseable extracted date to today instead of dropping the row", async () => {
    const session = new MockStructuredSession([
      () => ({
        result: {
          count: 2,
          rows: [
            { date: "Pending", amount: -1299, type: "expense", description: "Chipotle", sourceAccount: "", sourceCategory: "" },
            { date: "01/05/2026", amount: -700, type: "expense", description: "Uber", sourceAccount: "", sourceCategory: "" },
          ],
        },
      }),
    ]);

    const { rows } = await normalizeImage(session, { name: "r.png", content: "B64", mediaType: "image/png" });

    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today, never "Pending"
    expect(rows[1].date).toBe("2026-01-05");
  });

  it("tells the model to date pending / date-less rows to today", async () => {
    const session = new MockStructuredSession([() => ({ result: { count: 0, rows: [] } })]);
    await normalizeImage(session, { name: "r.png", content: "B64", mediaType: "image/png" });

    const prompt = JSON.stringify(session.calls[0].messages);
    expect(prompt).toContain("Pending");
    expect(prompt).toContain(`use today's date, ${getToday()}`);
  });

  it("sends an image block for an image and a document block for a PDF", async () => {
    const imgSession = new MockStructuredSession([() => ({ result: { count: 1, rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] } })]);
    await normalizeImage(imgSession, { name: "r.png", content: "B64", mediaType: "image/png" });
    expect(JSON.stringify(imgSession.calls[0].messages)).toContain('"type":"image"');

    const pdfSession = new MockStructuredSession([() => ({ result: { count: 1, rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] } })]);
    await normalizeImage(pdfSession, { name: "r.pdf", content: "B64", mediaType: "application/pdf" });
    expect(JSON.stringify(pdfSession.calls[0].messages)).toContain('"type":"document"');
  });

  it("returns noData for the no_data outcome", async () => {
    const session = new MockStructuredSession([() => ({ result: { error: "no_data", message: "Just a selfie." } })]);
    const { rows, noData } = await normalizeImage(session, { name: "s.png", content: "B64", mediaType: "image/png" });
    expect(rows).toHaveLength(0);
    expect(noData?.message).toBe("Just a selfie.");
  });

  it("treats an empty extraction as noData", async () => {
    const session = new MockStructuredSession([() => ({ result: { count: 0, rows: [] } })]);
    const { noData } = await normalizeImage(session, { name: "s.png", content: "B64", mediaType: "image/png" });
    expect(noData).toBeDefined();
  });

  it("reports streamed progress with the model-declared count as the total", async () => {
    const session = new MockStructuredSession([
      () => ({
        result: {
          count: 2,
          rows: [
            { date: "2026-01-01", amount: -1, type: "expense", description: "a", sourceAccount: "", sourceCategory: "" },
            { date: "2026-01-02", amount: -2, type: "expense", description: "b", sourceAccount: "", sourceCategory: "" },
          ],
        },
      }),
    ]);
    const ticks: NormalizeProgress[] = [];

    await normalizeImage(session, { name: "r.png", content: "B64", mediaType: "image/png" }, {
      onProgress: (p) => ticks.push(p),
    });

    // The mock streams the whole response as one delta.
    expect(ticks).toEqual([{ rows: 2, total: 2 }]);
  });
});

describe("countStreamedRows", () => {
  it("counts rows by their date keys and reads the declared count", () => {
    const text = '{"result":{"count":47,"rows":[{"date":"2026-01-01","amount":-1},{"date":"2026-01-02"';
    expect(countStreamedRows(text)).toEqual({ rows: 2, total: 47 });
  });

  it("leaves the total null before the count streams", () => {
    expect(countStreamedRows('{"result":{"co')).toEqual({ rows: 0, total: null });
  });

  it("declares count before rows in the schema, so the denominator streams first", () => {
    const rowsAlternative = EXTRACTION_SCHEMA.properties!.result.anyOf![0];
    expect(Object.keys(rowsAlternative.properties!)).toEqual(["count", "rows"]);
  });
});

describe("isImageOrPdf", () => {
  it("classifies images and PDFs as the extraction path", () => {
    expect(isImageOrPdf("image/png")).toBe(true);
    expect(isImageOrPdf("image/jpeg")).toBe(true);
    expect(isImageOrPdf("application/pdf")).toBe(true);
    expect(isImageOrPdf("text/csv")).toBe(false);
  });
});
