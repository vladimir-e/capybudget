import { describe, it, expect } from "vitest";
import { normalizeCsv, normalizeImage, isImageOrPdf, normalizeMapping } from "./normalize";
import { CSV_MAPPING_SCHEMA, EXTRACTION_SCHEMA } from "./schemas";
import { SchemaValidationError } from "../structured";
import { MockStructuredSession } from "./test-doubles";

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

  it("continues ids from startId for multi-file appends", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const session = new MockStructuredSession([() => MAPPING]);
    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv }, { startId: 10 });
    expect(rows[0].id).toBe("imp-10");
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
    });
    it("infers from the data when the sign is absent or unrecognized", () => {
      expect(sign(undefined, "-4.50")).toBe("negative_expense"); // negatives present
      expect(sign("???", "2.99")).toBe("positive_expense"); // all-positive (credit-card charges)
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

  it("sends an image block for an image and a document block for a PDF", async () => {
    const imgSession = new MockStructuredSession([() => ({ result: { rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] } })]);
    await normalizeImage(imgSession, { name: "r.png", content: "B64", mediaType: "image/png" });
    expect(JSON.stringify(imgSession.calls[0].messages)).toContain('"type":"image"');

    const pdfSession = new MockStructuredSession([() => ({ result: { rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] } })]);
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
    const session = new MockStructuredSession([() => ({ result: { rows: [] } })]);
    const { noData } = await normalizeImage(session, { name: "s.png", content: "B64", mediaType: "image/png" });
    expect(noData).toBeDefined();
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
