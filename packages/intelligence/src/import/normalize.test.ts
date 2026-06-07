import { describe, it, expect } from "vitest";
import { normalizeCsv, normalizeImage, isImageOrPdf } from "./normalize";
import { CSV_MAPPING_SCHEMA, EXTRACTION_SCHEMA } from "./schemas";
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

  it("continues ids from startId for multi-file appends", async () => {
    const csv = "Date,Description,Amount\n2026-01-05,COFFEE,-4.50";
    const session = new MockStructuredSession([() => MAPPING]);
    const { rows } = await normalizeCsv(session, { name: "f.csv", content: csv }, { startId: 10 });
    expect(rows[0].id).toBe("imp-10");
  });
});

describe("normalizeImage", () => {
  it("extracts rows and feeds them through buildStaged", async () => {
    const session = new MockStructuredSession([
      () => ({
        rows: [
          { date: "2026-01-05", amount: -1599, type: "expense", description: "Netflix", sourceAccount: "Visa", sourceCategory: "Entertainment" },
        ],
      }),
    ]);

    const { rows, noData } = await normalizeImage(session, { name: "r.png", content: "B64", mediaType: "image/png" });

    expect(noData).toBeUndefined();
    expect(session.calls[0].schema).toBe(EXTRACTION_SCHEMA);
    expect(rows[0]).toMatchObject({ id: "imp-1", description: "Netflix", merchant: "", categoryId: "" });
    expect(rows[0].sourceCategory).toBe("Entertainment");
  });

  it("sends an image block for an image and a document block for a PDF", async () => {
    const imgSession = new MockStructuredSession([() => ({ rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] })]);
    await normalizeImage(imgSession, { name: "r.png", content: "B64", mediaType: "image/png" });
    expect(JSON.stringify(imgSession.calls[0].messages)).toContain('"type":"image"');

    const pdfSession = new MockStructuredSession([() => ({ rows: [{ date: "2026-01-01", amount: -1, type: "expense", description: "x", sourceAccount: "", sourceCategory: "" }] })]);
    await normalizeImage(pdfSession, { name: "r.pdf", content: "B64", mediaType: "application/pdf" });
    expect(JSON.stringify(pdfSession.calls[0].messages)).toContain('"type":"document"');
  });

  it("returns noData for the no_data outcome", async () => {
    const session = new MockStructuredSession([() => ({ error: "no_data", message: "Just a selfie." })]);
    const { rows, noData } = await normalizeImage(session, { name: "s.png", content: "B64", mediaType: "image/png" });
    expect(rows).toHaveLength(0);
    expect(noData?.message).toBe("Just a selfie.");
  });

  it("treats an empty extraction as noData", async () => {
    const session = new MockStructuredSession([() => ({ rows: [] })]);
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
