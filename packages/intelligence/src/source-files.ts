/**
 * One owner for how a source file is classified and handed to the model.
 *
 * Both on-ramps — Import (a `SourceFile` from `.capy/import/sources/`) and chat
 * (a `FileAttachment`) — need the same three answers: what media type does this
 * filename imply, which normalization path does that media type take, and what
 * content block carries its bytes to the model. Keeping those rules here means
 * the staging store, the normalizer, the chat hook, and the app's browser-`File`
 * predicates all read from one source of truth instead of each re-deriving it.
 */

import type { CliDocumentContent, CliImageContent } from "./types"

/** Conventional media type for the OFX family (.ofx/.qfx/.qbo). Not an IANA
 *  type, but the de-facto one financial tools use, and the routing key the
 *  deterministic OFX normalizer keys off. */
export const OFX_MEDIA_TYPE = "application/x-ofx"

// No image/bmp — no model provider accepts it, so a .bmp is better refused at
// the drop gate than uploaded to a guaranteed 400.
const IMAGE_MEDIA_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
}

const OFX_EXTENSIONS = new Set([".ofx", ".qfx", ".qbo"])

/** Extension including the leading dot, lowercased; "" when the name has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot === -1 ? "" : name.slice(dot).toLowerCase()
}

export function isImageFilename(name: string): boolean {
  return fileExtension(name) in IMAGE_MEDIA_TYPE_BY_EXT
}

export function isPdfFilename(name: string): boolean {
  return fileExtension(name) === ".pdf"
}

export function isOfxFilename(name: string): boolean {
  return OFX_EXTENSIONS.has(fileExtension(name))
}

/**
 * Filename → media type. Images and PDFs get their real types, the OFX family
 * gets {@link OFX_MEDIA_TYPE}, and everything else defaults to `text/csv` — the
 * import pipeline reads any other text as a delimited table for the CSV mapper.
 */
export function mediaTypeForFilename(name: string): string {
  const ext = fileExtension(name)
  if (ext in IMAGE_MEDIA_TYPE_BY_EXT) return IMAGE_MEDIA_TYPE_BY_EXT[ext]
  if (ext === ".pdf") return "application/pdf"
  if (OFX_EXTENSIONS.has(ext)) return OFX_MEDIA_TYPE
  return "text/csv"
}

/** The normalization path a source takes. `tabular` covers every text source
 *  the CSV mapper handles (delimited or plain); the other three each have their
 *  own path. */
export type SourceKind = "image" | "pdf" | "ofx" | "tabular"

export function classifySource(mediaType: string): SourceKind {
  if (mediaType.startsWith("image/")) return "image"
  if (mediaType === "application/pdf") return "pdf"
  if (mediaType === OFX_MEDIA_TYPE) return "ofx"
  return "tabular"
}

/**
 * Classify a file whose reported media type may be missing or generic — a
 * browser drop reports `""` or `application/octet-stream` for many formats. A
 * definitive reported type wins; otherwise the extension decides.
 */
export function classifyFile(file: { name: string; mediaType?: string }): SourceKind {
  const reported = classifySource(file.mediaType ?? "")
  return reported === "tabular" ? classifySource(mediaTypeForFilename(file.name)) : reported
}

/**
 * The concrete media type a file's bytes should ride with. A definitive
 * reported type wins; when it's missing or generic — a browser drop reports `""`
 * or `application/octet-stream` for many images and PDFs — the extension
 * decides. The fallback resolves in lockstep with {@link classifyFile}, so what
 * the send path classifies matches the media type the block carries.
 */
export function effectiveMediaType(file: { name: string; mediaType?: string }): string {
  const reported = file.mediaType ?? ""
  return classifySource(reported) === "tabular" ? mediaTypeForFilename(file.name) : reported
}

/**
 * The image/document content block that carries a binary source's bytes to the
 * model — the shared shape both on-ramps emit. PDFs ride as a `document` block
 * (filename included, which OpenAI's file part requires); images ride as an
 * `image` block. `content` is base64, matching {@link OFX_MEDIA_TYPE}-less
 * binary staging.
 */
export function sourceContentBlock(file: {
  name: string
  content: string
  mediaType: string
}): CliImageContent | CliDocumentContent {
  if (file.mediaType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: file.mediaType, data: file.content },
      filename: file.name,
    }
  }
  return {
    type: "image",
    source: { type: "base64", media_type: file.mediaType, data: file.content },
  }
}
