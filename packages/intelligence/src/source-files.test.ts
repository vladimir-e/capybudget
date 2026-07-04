import { describe, expect, it } from "vitest"
import {
  OFX_MEDIA_TYPE,
  classifyFile,
  classifySource,
  fileExtension,
  isImageFilename,
  isOfxFilename,
  isPdfFilename,
  mediaTypeForFilename,
  sourceContentBlock,
} from "./source-files"

describe("mediaTypeForFilename", () => {
  it("maps images and PDFs to their real types", () => {
    expect(mediaTypeForFilename("receipt.PNG")).toBe("image/png")
    expect(mediaTypeForFilename("scan.jpeg")).toBe("image/jpeg")
    expect(mediaTypeForFilename("statement.pdf")).toBe("application/pdf")
  })

  it("maps the OFX family to the OFX media type", () => {
    expect(mediaTypeForFilename("export.ofx")).toBe(OFX_MEDIA_TYPE)
    expect(mediaTypeForFilename("export.QFX")).toBe(OFX_MEDIA_TYPE)
    expect(mediaTypeForFilename("export.qbo")).toBe(OFX_MEDIA_TYPE)
  })

  it("defaults everything else to text/csv", () => {
    expect(mediaTypeForFilename("data.csv")).toBe("text/csv")
    expect(mediaTypeForFilename("ledger.tsv")).toBe("text/csv")
    expect(mediaTypeForFilename("noextension")).toBe("text/csv")
    expect(mediaTypeForFilename("mystery.qif")).toBe("text/csv")
  })
})

describe("classifySource", () => {
  it("routes each media type to its normalization path", () => {
    expect(classifySource("image/png")).toBe("image")
    expect(classifySource("application/pdf")).toBe("pdf")
    expect(classifySource(OFX_MEDIA_TYPE)).toBe("ofx")
    expect(classifySource("text/csv")).toBe("tabular")
    expect(classifySource("application/json")).toBe("tabular")
  })
})

describe("classifyFile", () => {
  it("prefers a definitive reported media type", () => {
    expect(classifyFile({ name: "x.bin", mediaType: "image/png" })).toBe("image")
    expect(classifyFile({ name: "x.bin", mediaType: "application/pdf" })).toBe("pdf")
  })

  it("falls back to the extension when the reported type is missing or generic", () => {
    expect(classifyFile({ name: "STATEMENT.PDF", mediaType: "" })).toBe("pdf")
    expect(classifyFile({ name: "card.qfx", mediaType: "text/plain" })).toBe("ofx")
    expect(classifyFile({ name: "photo.jpg", mediaType: "application/octet-stream" })).toBe("image")
    expect(classifyFile({ name: "unknown", mediaType: "application/octet-stream" })).toBe("tabular")
  })
})

describe("filename predicates", () => {
  it("classifies by extension, case-insensitively", () => {
    expect(isImageFilename("a.JPG")).toBe(true)
    expect(isImageFilename("a.csv")).toBe(false)
    expect(isPdfFilename("a.PDF")).toBe(true)
    expect(isOfxFilename("a.qbo")).toBe(true)
    expect(isOfxFilename("a.qif")).toBe(false)
    expect(fileExtension("a.b.csv")).toBe(".csv")
    expect(fileExtension("noext")).toBe("")
  })
})

describe("sourceContentBlock", () => {
  it("builds a document block for PDFs, with the filename", () => {
    const block = sourceContentBlock({ name: "s.pdf", content: "JVBER", mediaType: "application/pdf" })
    expect(block).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBER" },
      filename: "s.pdf",
    })
  })

  it("builds an image block for everything else", () => {
    const block = sourceContentBlock({ name: "p.png", content: "iVBOR", mediaType: "image/png" })
    expect(block).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBOR" },
    })
  })
})
