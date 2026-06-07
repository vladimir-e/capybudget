import { describe, expect, it } from "vitest"
import {
  isImportBinaryFile,
  isImportTextFile,
  readFileAsBase64,
} from "./file-attachments"

function fileOf(name: string, type: string, bytes: Uint8Array): File {
  return new File([bytes], name, { type })
}

// A handful of bytes outside the ASCII range — the kind a real PNG/PDF carries
// and the kind that breaks when binary is decoded as UTF-8 text.
const BINARY_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01, 0x80])

describe("isImportBinaryFile", () => {
  it("flags images by MIME", () => {
    expect(isImportBinaryFile(fileOf("receipt.png", "image/png", BINARY_BYTES))).toBe(true)
  })

  it("flags images by extension when MIME is missing", () => {
    expect(isImportBinaryFile(fileOf("receipt.JPG", "", BINARY_BYTES))).toBe(true)
  })

  it("flags PDFs by MIME and by extension", () => {
    expect(isImportBinaryFile(fileOf("statement.pdf", "application/pdf", BINARY_BYTES))).toBe(true)
    expect(isImportBinaryFile(fileOf("statement.PDF", "", BINARY_BYTES))).toBe(true)
  })

  it("does not flag text formats", () => {
    expect(isImportBinaryFile(fileOf("export.csv", "text/csv", BINARY_BYTES))).toBe(false)
    expect(isImportBinaryFile(fileOf("export.ofx", "", BINARY_BYTES))).toBe(false)
  })
})

describe("binary source staging round-trip", () => {
  // The bug this guards: the drop path wrote binary bytes that the staging
  // store reads back as text and hands to the model as base64. base64-encoding
  // on drop makes the bytes survive the text round-trip intact.
  it("encodes binary bytes to base64 that decodes back unchanged", async () => {
    const file = fileOf("receipt.png", "image/png", BINARY_BYTES)
    const staged = await readFileAsBase64(file)

    // The staging store carries `content` as text and reads it back as text;
    // simulate that pass-through (it's a string-identity hop) then decode.
    const roundTripped = staged
    const decoded = Uint8Array.from(atob(roundTripped), (c) => c.charCodeAt(0))

    expect(decoded).toEqual(BINARY_BYTES)
  })

  it("PDFs are binary and stage the same way as images", () => {
    // Regression guard: a PDF is staged as binary even though it passes the
    // text drop-zone gate. Reading it as UTF-8 text (the old path) would corrupt
    // it before the model ever sees it.
    const pdf = fileOf("statement.pdf", "application/pdf", BINARY_BYTES)
    expect(isImportBinaryFile(pdf)).toBe(true)
    expect(isImportTextFile(pdf)).toBe(true) // still passes the drop-zone gate
  })
})
