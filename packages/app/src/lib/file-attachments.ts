import {
  fileExtension,
  isImageFilename,
  isOfxFilename,
  isPdfFilename,
} from "@capybudget/intelligence"

/** Plain-text formats the drop zones accept. Format classification (image, PDF,
 *  OFX family) lives in `@capybudget/intelligence`; this is only the accept
 *  policy for non-financial text the browser layer gates on. */
const TEXT_EXTENSIONS = new Set([".csv", ".tsv", ".json", ".xml", ".md", ".txt", ".log"])

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true
  if (file.type === "application/json" || file.type === "application/xml") return true
  return TEXT_EXTENSIONS.has(fileExtension(file.name))
}

/**
 * Text predicate for import source files: like {@link isTextFile} but also
 * accepts the OFX statement family (.ofx/.qfx/.qbo) and treats PDFs as text so
 * they pass the import drop-zone gate (PDF bytes ride the message later).
 */
export function isImportTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true
  if (file.type === "application/json" || file.type === "application/xml") return true
  if (file.type === "application/pdf") return true
  return TEXT_EXTENSIONS.has(fileExtension(file.name)) || isOfxFilename(file.name)
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || isImageFilename(file.name)
}

/** Whether a file is a PDF, by MIME type or `.pdf` extension (browsers sometimes
 *  report a PDF as `application/octet-stream`). */
export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || isPdfFilename(file.name)
}

/**
 * Whether an import source must be staged as base64 rather than UTF-8 text.
 * Images and PDFs are binary; the staging store's `content` channel carries
 * them as base64 text (matching what the model is handed), so the drop path
 * must encode them — writing raw bytes corrupts the round-trip.
 */
export function isImportBinaryFile(file: File): boolean {
  return isImageFile(file) || isPdfFile(file)
}

export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Encode raw bytes as base64 without choking on large payloads. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000 // ~32 KB at a time — keeps the call stack happy
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
