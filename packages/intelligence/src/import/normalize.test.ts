import { describe, it, expect } from "vitest";
import { normalizeCsv, normalizeImage, isImageOrPdf, completeMapping } from "./normalize";
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
    const badMapping = { ...MAPPING, date: { column: "Date", format: "ZZZ" } }; // unsupported format → error
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
    // sourceAccount, or date.format. completeMapping infers them; no re-call.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50\n2026-01-06,SALARY,2000.00";
    const rolesOnly = {
      date: { column: "Date" },
      description: { column: "Description" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    };
    const session = new MockStructuredSession([() => rolesOnly]);

    const { rows, mapping } = await normalizeCsv(session, { name: "checking.csv", content: csv });

    expect(session.calls).toHaveLength(1); // no retry — metadata is inferred, not demanded
    expect(mapping.date.format).toBe("YYYY-MM-DD");
    expect(mapping.amountFormat.format).toBe("plain");
    expect(mapping.typeDetection).toEqual({ method: "amount_sign" });
    expect(mapping.sourceAccount).toEqual({ literal: "checking" });
    expect(mapping.sourceCategory).toBeNull();
    expect(rows[0]).toMatchObject({ amount: -450, type: "expense" });
    expect(rows[1]).toMatchObject({ amount: 200000, type: "income" });
  });

  it("still surfaces an error when a core field stays missing after the retry", async () => {
    // `description` is a core role the model must decide — inference can't recover
    // it. A persistently omitted core field surfaces rather than being masked.
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const noDescription = {
      date: { column: "Date", format: "YYYY-MM-DD" },
      amount: { style: "single", column: "Amount", sign: "negative_expense" },
    };
    const session = new MockStructuredSession([() => noDescription, () => noDescription]);

    await expect(normalizeCsv(session, { name: "f.csv", content: csv })).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(session.calls).toHaveLength(2); // one retry, then surfaced — not masked
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

describe("completeMapping", () => {
  const ROLES = {
    date: { column: "Date" },
    description: { column: "Description" } as const,
    amount: { style: "single", column: "Amount", sign: "negative_expense" } as const,
  };
  const sampleWith = (overrides: Record<string, string>) => [{ Date: "2026-01-01", Description: "X", Amount: "1", ...overrides }];

  it("fills every omitted metadata field, defaulting sourceCategory to null", () => {
    const m = completeMapping(ROLES, sampleWith({ Date: "2026-01-05", Amount: "-4.50" }), "wells-fargo_2026.csv");
    expect(m.date.format).toBe("YYYY-MM-DD");
    expect(m.amountFormat.format).toBe("plain");
    expect(m.typeDetection).toEqual({ method: "amount_sign" });
    expect(m.sourceAccount).toEqual({ literal: "wells fargo 2026" });
    expect(m.sourceCategory).toBeNull();
  });

  it("keeps a model-provided date.format over inference", () => {
    const m = completeMapping(
      { ...ROLES, date: { column: "Date", format: "DD/MM/YYYY" } },
      sampleWith({ Date: "01/05/2026" }),
      "f.csv",
    );
    expect(m.date.format).toBe("DD/MM/YYYY");
  });

  describe("amountFormat inference", () => {
    const fmt = (amount: string) => completeMapping(ROLES, sampleWith({ Amount: amount }), "f.csv").amountFormat.format;
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
    const df = (date: string) => completeMapping(ROLES, sampleWith({ Date: date }), "f.csv").date.format;
    it("ISO and dotted forms", () => {
      expect(df("2026-01-05")).toBe("YYYY-MM-DD");
      expect(df("2026/01/05")).toBe("YYYY/MM/DD");
      expect(df("25.01.2026")).toBe("DD.MM.YYYY");
    });
    it("defaults ambiguous slash dates to US MM/DD/YYYY", () => {
      expect(df("01/05/2026")).toBe("MM/DD/YYYY");
    });
    it("picks DD/MM when a first component exceeds 12", () => {
      expect(completeMapping(ROLES, [{ Date: "13/05/2026", Description: "X", Amount: "1" }], "f.csv").date.format).toBe(
        "DD/MM/YYYY",
      );
    });
    it("picks MM/DD when a second component exceeds 12", () => {
      expect(completeMapping(ROLES, [{ Date: "05/13/2026", Description: "X", Amount: "1" }], "f.csv").date.format).toBe(
        "MM/DD/YYYY",
      );
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
