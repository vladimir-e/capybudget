/**
 * `start_import` — the chat on-ramp into the import pipeline.
 *
 * Capy never reads an uploaded file and inserts its rows directly. When a file
 * arrives in chat it calls this tool, which copies the turn's attachments into
 * `.capy/import/sources/` and marks the run as Capy-staged. The Import screen,
 * on mount, sees sources with no `transactions.csv` and a `state.json` it didn't
 * write itself, and auto-runs `orchestrator.start()` — so both on-ramps (the
 * Import tab's manual Start and this tool) converge on the same staging and the
 * same orchestrator. The model's reply points the user at the Import tab.
 *
 * The bytes live on the chat turn, not in the tool arguments: text files are
 * inlined into the message and images ride as base64 content blocks, neither of
 * which the model can faithfully echo back. So the handler stages from
 * `ctx.attachments` — the raw attachments the adapter threads through for the
 * in-flight turn — and ignores any file content the model put in `args`.
 *
 * Gates return guidance instead of staging, so the model relays a clear next
 * step rather than failing opaquely:
 *   - `importSupported` is false (provider is claude-cli / off) → tell the user
 *     to switch to Anthropic or OpenAI.
 *   - no attachments on the turn → tell the user to attach the file (or use the
 *     Import tab for bulk).
 *   - a PDF attachment under a provider that can't read PDFs → tell the user to
 *     switch to a PDF-capable provider. Staging it would start a run the model is
 *     blind to. Mirrors the Import tab's PDF-drop gate (`canReadPdf`).
 *   - staging already holds an import — a run in flight or parked for review,
 *     or files dropped in the Import tab but not started → point the user at
 *     the Import tab. The only thing a chat share may replace is a prior chat
 *     staging that never ran.
 */

import { FileStagingStore } from "../../import/staging-store"
import type { FileAttachment } from "../../types"
import type { ToolContext } from "../dispatch"

function isPdf(file: FileAttachment): boolean {
  return file.mediaType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
}

const IMPORT_IN_PROGRESS = JSON.stringify({
  started: false,
  reason: "import_in_progress",
  message:
    "An import is already in progress. Tell the user to open the Import tab to finish reviewing and merging it — or cancel it there — then re-share the file.",
})

export async function handleStartImport(ctx: ToolContext): Promise<string> {
  if (!ctx.importSupported) {
    return JSON.stringify({
      started: false,
      reason: "provider_unsupported",
      message:
        "File import needs the Anthropic or OpenAI provider. Tell the user to switch in Settings, then re-share the file — or to use the Import tab.",
    })
  }

  const attachments = ctx.attachments ?? []
  if (attachments.length === 0) {
    return JSON.stringify({
      started: false,
      reason: "no_attachment",
      message:
        "No file was attached to this message. Ask the user to attach the file (the paperclip), or to use the Import tab for a bulk export.",
    })
  }

  if (!ctx.pdfSupported && attachments.some(isPdf)) {
    return JSON.stringify({
      started: false,
      reason: "pdf_unsupported",
      message:
        "This provider can't read PDFs. Tell the user to switch to Anthropic or OpenAI in Settings and re-share, or to export the statement to CSV.",
    })
  }

  const staging = new FileStagingStore(ctx.fileAdapter, ctx.budgetPath)

  // The staging area may already be owned by an import this handler must not
  // clobber. Refuse unless staging is empty or holds only a chat-staged import
  // that never ran (`state.json` marked "chat", no `transactions.csv`) — that's
  // the user re-sharing a file, and replacing the stale staging is right.
  // Accepted residual window: a manual run still in Reading/Normalizing has
  // written neither state.json nor transactions.csv, so it reads as a parked
  // drop here (refused, never clobbered) — those phases are seconds long.
  if ((await staging.readTransactions()) !== null) {
    return IMPORT_IN_PROGRESS
  }
  const state = await staging.readState()
  if (state !== null && state.source !== "chat") {
    return IMPORT_IN_PROGRESS
  }
  if (state === null && (await staging.listSources()).length > 0) {
    return JSON.stringify({
      started: false,
      reason: "files_already_staged",
      message:
        "Files are already staged in the Import tab but the import hasn't started. Tell the user to start it — or remove the files — in the Import tab first.",
    })
  }

  // Past the gates, any leftover is a stale chat staging — clear it so the
  // orchestrator starts from this turn's sources alone.
  await staging.clear()
  for (const file of attachments) {
    await staging.writeSource(file.name, file.content)
  }
  await staging.writeState({
    phase: "reading",
    source: "chat",
    updatedAt: new Date().toISOString(),
  })

  const names = attachments.map((f) => f.name).join(", ")
  return JSON.stringify({
    started: true,
    files: attachments.map((f) => f.name),
    message: `Staged ${names} for import. Tell the user it's uploaded and the import is starting — point them to the Import tab to review.`,
  })
}
