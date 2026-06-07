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
 * Two gates return guidance instead of staging, so the model relays a clear next
 * step rather than failing opaquely:
 *   - `importSupported` is false (provider is claude-cli / off) → tell the user
 *     to switch to Anthropic or OpenAI.
 *   - no attachments on the turn → tell the user to attach the file (or use the
 *     Import tab for bulk).
 */

import { FileStagingStore } from "../../import/staging-store"
import type { ToolContext } from "../dispatch"

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

  const staging = new FileStagingStore(ctx.fileAdapter, ctx.budgetPath)
  // A fresh chat import owns the staging area — clear any prior run's artifacts
  // so the orchestrator starts from these sources, not a stale resume.
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
