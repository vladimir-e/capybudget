import { describe, it, expect } from "vitest"
import {
  isImageAttachment,
  isPdfAttachment,
  formatAttachments,
  formatFileSize,
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
} from "./attachments"
import type { FileAttachment } from "./types"

function file(name: string, mediaType: string, content = ""): FileAttachment {
  return { name, content, size: content.length, mediaType }
}

describe("isImageAttachment", () => {
  it("returns true for image MIME types", () => {
    expect(isImageAttachment(file("photo.png", "image/png"))).toBe(true)
    expect(isImageAttachment(file("pic.jpg", "image/jpeg"))).toBe(true)
    expect(isImageAttachment(file("anim.gif", "image/gif"))).toBe(true)
  })

  it("returns false for non-image MIME types", () => {
    expect(isImageAttachment(file("data.csv", "text/csv"))).toBe(false)
    expect(isImageAttachment(file("config.json", "application/json"))).toBe(false)
    expect(isImageAttachment(file("unknown", "application/octet-stream"))).toBe(false)
  })
})

describe("isPdfAttachment", () => {
  it("returns true for the PDF MIME type or a .pdf name", () => {
    expect(isPdfAttachment(file("statement.pdf", "application/pdf"))).toBe(true)
    expect(isPdfAttachment(file("STATEMENT.PDF", ""))).toBe(true)
  })

  it("returns false for non-PDF attachments", () => {
    expect(isPdfAttachment(file("photo.png", "image/png"))).toBe(false)
    expect(isPdfAttachment(file("data.csv", "text/csv"))).toBe(false)
  })
})

describe("formatAttachments", () => {
  it("returns empty string for empty array", () => {
    expect(formatAttachments([])).toBe("")
  })

  it("returns empty string when all files are images", () => {
    expect(formatAttachments([file("a.png", "image/png")])).toBe("")
  })

  it("wraps text files with filename markers", () => {
    const result = formatAttachments([file("data.csv", "text/csv", "a,b\n1,2")])
    expect(result).toBe("[Attached file: data.csv]\na,b\n1,2\n[End of file: data.csv]")
  })

  it("joins multiple text files with blank line", () => {
    const result = formatAttachments([
      file("a.csv", "text/csv", "row1"),
      file("b.ofx", "application/xml", "<ofx>"),
    ])
    expect(result).toContain("[End of file: a.csv]\n\n[Attached file: b.ofx]")
  })

  it("skips images and PDFs, including text files only", () => {
    const result = formatAttachments([
      file("photo.png", "image/png", "binary"),
      file("statement.pdf", "application/pdf", "JVBERi0x"),
      file("data.csv", "text/csv", "a,b"),
    ])
    expect(result).toContain("data.csv")
    expect(result).not.toContain("photo.png")
    expect(result).not.toContain("statement.pdf")
  })
})

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(0)).toBe("0B")
    expect(formatFileSize(512)).toBe("512B")
    expect(formatFileSize(1023)).toBe("1023B")
  })

  it("formats kilobytes", () => {
    expect(formatFileSize(1024)).toBe("1KB")
    expect(formatFileSize(1536)).toBe("2KB")
    expect(formatFileSize(1_048_575)).toBe("1024KB")
  })

  it("formats megabytes", () => {
    expect(formatFileSize(1_048_576)).toBe("1.0MB")
    expect(formatFileSize(5_242_880)).toBe("5.0MB")
  })
})

describe("constants", () => {
  it("MAX_ATTACHMENT_SIZE is 5MB", () => {
    expect(MAX_ATTACHMENT_SIZE).toBe(5 * 1024 * 1024)
  })

  it("MAX_TOTAL_ATTACHMENT_SIZE is 10MB", () => {
    expect(MAX_TOTAL_ATTACHMENT_SIZE).toBe(10 * 1024 * 1024)
  })
})
