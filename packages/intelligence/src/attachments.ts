/**
 * File attachment constants and utilities for the intelligence layer.
 */

import { classifyFile } from "./source-files"
import type { FileAttachment } from "./types"

export const MAX_ATTACHMENT_SIZE = 5_242_880 // 5MB per file
export const MAX_TOTAL_ATTACHMENT_SIZE = 10_485_760 // 10MB total

export function isImageAttachment(file: FileAttachment): boolean {
  return classifyFile(file) === "image"
}

export function isPdfAttachment(file: FileAttachment): boolean {
  return classifyFile(file) === "pdf"
}

/** Format text-based attachments for inlining in the message. Images and PDFs
 *  ride as content blocks, so they're excluded here — their base64 content is
 *  not text to paste. */
export function formatAttachments(files: FileAttachment[]): string {
  const textFiles = files.filter((f) => !isImageAttachment(f) && !isPdfAttachment(f))
  if (textFiles.length === 0) return ""
  return textFiles
    .map(
      (f) =>
        `[Attached file: ${f.name}]\n${f.content}\n[End of file: ${f.name}]`,
    )
    .join("\n\n")
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1_048_576).toFixed(1)}MB`
}
