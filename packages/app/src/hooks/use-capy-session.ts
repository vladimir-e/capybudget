/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Lazy-spawns Claude CLI on first message
 * - Parses streaming events into ChatMessage[]
 * - Handles session restart on crash or "New Chat"
 * - Detects mutation tool calls and notifies for cache invalidation
 * - On stop: forwards conversation context to the next session
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle"
import { mergeStreamContent } from "@/hooks/merge-stream-content"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import {
  buildContext,
  formatAttachments,
  isImageAttachment,
  isPdfAttachment,
  buildSystemPrompt,
  MUTATION_TOOL_NAMES,
  START_IMPORT_TOOL_NAME,
  type BudgetSnapshot,
  type FileAttachment,
  type MessageContent,
  type StreamEvent,
  type ChatMessage,
  type ContentBlock,
} from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"
import type { CurrencySettings } from "@capybudget/core"

export interface UseCapySessionOptions {
  budgetPath: string
  budgetName: string
  mcpServerPath: string
  /** Budget's default currency (ISO 4217), baked into the prompt + snapshot. */
  currency: string
  /** Per-currency settings, threaded into tool dispatch so AI-created foreign
   *  transactions stamp their rate and money totals roll up into the default. */
  currencies?: Record<string, CurrencySettings>
  /** English name of the active UI language, baked into the prompt; joins the
   *  session signature so a switch rebuilds. */
  language?: string
  customInstructions?: string
  /** Snapshot of the budget's current shape, attached to the first message
   *  of a session so Capy knows what it's working with without a tool call.
   *  Called lazily at first-send time to read the freshest data. */
  getBudgetSnapshot?: () => BudgetSnapshot | undefined
  onDataChanged?: () => void
  /** Fired when Capy's `start_import` lands — the chat staged the attachment(s)
   *  into `.capy/import/`, so the app navigates to the Import tab, where the
   *  screen auto-runs the orchestrator over the Capy-staged sources. */
  onImportStarted?: () => void
  /** Required by API adapters (in-process tool dispatch); ignored by Claude CLI. */
  repo?: BudgetRepository
  /** Required by API adapters (in-process tool dispatch); ignored by Claude CLI. */
  fileAdapter?: FileAdapter
}

interface UseCapySessionReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  sendMessage: (text: string, files?: FileAttachment[]) => void
  stopStreaming: () => void
  newChat: () => void
}

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const hadMutationsRef = useRef(false)
  const ackedToolCallsRef = useRef<Set<string>>(new Set())
  // Snapshot rides on the first message of each session only.
  const snapshotSentRef = useRef(false)

  // Read through a ref: stable lifecycle callbacks don't re-create per render,
  // so closing over `t` directly would go stale on a language switch.
  const { t } = useTranslation("capy")
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  // Keep a ref to messages for use in sendMessage / stopStreaming without
  // stale closures.
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  })

  const lifecycle = useSessionLifecycle(
    opts,
    (event: StreamEvent, ctx) => {
      switch (event.type) {
        case "content": {
          setMessages((prev) => mergeStreamContent(prev, event.blocks))

          for (const block of event.blocks) {
            if (block.type === "tool-activity" && MUTATION_TOOL_NAMES.has(block.tool)) {
              hadMutationsRef.current = true
              break
            }
          }
          break
        }

        case "tool-result": {
          if (!event.ok) break
          if (ackedToolCallsRef.current.has(event.id)) break
          if (event.tool === START_IMPORT_TOOL_NAME) {
            ackedToolCallsRef.current.add(event.id)
            ctx.optsRef.current.onImportStarted?.()
            break
          }
          if (!MUTATION_TOOL_NAMES.has(event.tool)) break
          ackedToolCallsRef.current.add(event.id)
          ctx.optsRef.current.onDataChanged?.()
          break
        }

        case "done":
          ctx.setIsStreaming(false)
          // Fallback: mutation was requested but no per-call ack landed.
          if (hadMutationsRef.current && ackedToolCallsRef.current.size === 0) {
            ctx.optsRef.current.onDataChanged?.()
          }
          hadMutationsRef.current = false
          ackedToolCallsRef.current = new Set()
          break

        case "error":
          ctx.setIsStreaming(false)
          hadMutationsRef.current = false
          ackedToolCallsRef.current = new Set()
          setMessages((prev) => {
            const errorBlock: ContentBlock = {
              type: "error",
              message: event.message,
              status: event.status,
              provider: event.provider,
            }
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role !== "assistant") {
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  blocks: [errorBlock],
                },
              ]
            }
            updated[updated.length - 1] = {
              ...last,
              blocks: [...last.blocks, errorBlock],
            }
            return updated
          })
          break
      }
    },
    "capy",
    // onExit — process crashed unexpectedly, append recovery message
    () => {
      hadMutationsRef.current = false
      ackedToolCallsRef.current = new Set()
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          blocks: [
            {
              type: "text",
              content: tRef.current("session.endedUnexpectedly"),
            },
          ],
        },
      ])
    },
  )

  const ensureSession = useCallback(() => {
    if (!lifecycle.sessionRef.current) {
      const o = lifecycle.optsRef.current
      const basePrompt = buildSystemPrompt(o.currency, o.language)
      const customInstructions = o.customInstructions?.trim()
      const systemPrompt = customInstructions
        ? `${basePrompt}\n\n## User instructions\n${customInstructions}`
        : basePrompt

      lifecycle.createSession(systemPrompt)
    }
    return lifecycle.sessionRef.current
  }, [lifecycle])

  // Tear down the session and wipe the on-screen conversation. The session
  // bakes its adapter, model, and instructions in at creation, so a fresh
  // chat is the only honest reset — carrying old messages into a new session
  // would show a continuous thread the new model never actually saw.
  const resetConversation = useCallback(() => {
    lifecycle.cancel()
    setMessages([])
    hadMutationsRef.current = false
    ackedToolCallsRef.current = new Set()
    snapshotSentRef.current = false
  }, [lifecycle])

  // When the user changes provider or swaps the model within a provider,
  // start a fresh chat: the running session targets the old adapter/model and
  // has no memory of these turns anyway. Without the reset, `ensureSession()`
  // would either short-circuit on the still-populated `sessionRef` (routing
  // messages to the previous adapter) or spin up a new session under a thread
  // that visually implies continuity it doesn't have.
  const provider = useIntelligenceStore((s) => s.config.provider)
  const anthropicModel = useIntelligenceStore((s) => s.config.anthropic.model)
  const openaiModel = useIntelligenceStore((s) => s.config.openai.model)
  const claudeCliModel = useIntelligenceStore((s) => s.config.claudeCli.model)
  const providerSignature =
    provider === "anthropic"
      ? `anthropic:${anthropicModel}`
      : provider === "openai"
        ? `openai:${openaiModel}`
        : provider === "claude-cli"
          ? `claude-cli:${claudeCliModel}`
          : (provider ?? "off") // null carries no model — stable string signature
  // Currency and language are baked into the prompt, so they join the signature:
  // a switch changes it and rebuilds the session.
  const sessionSignature = `${providerSignature}:cur=${opts.currency}:lng=${opts.language ?? "en"}`
  const prevSignatureRef = useRef(sessionSignature)
  useEffect(() => {
    if (prevSignatureRef.current !== sessionSignature) {
      // Gated by the signature change — fires only on a real provider/model
      // swap, not on every render, so the reset can't cascade.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetConversation()
      prevSignatureRef.current = sessionSignature
    }
  }, [sessionSignature, resetConversation])

  const sendMessage = useCallback(
    (text: string, files?: FileAttachment[]) => {
      if (lifecycle.isStreamingRef.current) return
      const o = lifecycle.optsRef.current
      const snapshot = snapshotSentRef.current ? undefined : o.getBudgetSnapshot?.()
      snapshotSentRef.current = true
      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
        snapshot,
      })

      const allFiles = files ?? []
      const imageFiles = allFiles.filter(isImageAttachment)
      const pdfFiles = allFiles.filter(isPdfAttachment)
      const attachmentText = formatAttachments(allFiles)

      let enrichedText = `${context}\n${text}`
      if (attachmentText) {
        enrichedText += "\n\n" + attachmentText
      }

      // Build multimodal content when images or PDFs are attached
      let content: MessageContent
      if (imageFiles.length > 0 || pdfFiles.length > 0) {
        content = [
          { type: "text", text: enrichedText },
          ...imageFiles.map((f) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: f.mediaType,
              data: f.content,
            },
          })),
          ...pdfFiles.map((f) => ({
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: f.mediaType,
              data: f.content,
            },
            filename: f.name,
          })),
        ]
      } else {
        content = enrichedText
      }

      const blocks: ContentBlock[] = []
      if (text) {
        blocks.push({ type: "text", content: text })
      }
      for (const f of allFiles) {
        blocks.push({ type: "file-attachment", name: f.name, size: f.size, mediaType: f.mediaType })
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        blocks,
      }
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        blocks: [],
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      lifecycle.setIsStreaming(true)
      hadMutationsRef.current = false
      ackedToolCallsRef.current = new Set()

      const session = ensureSession()
      if (!session) {
        // Intelligence is unconfigured (or the chosen provider isn't
        // available). Surface a single-turn error message and bail —
        // Round 4 will replace this with a proper empty-state CTA.
        lifecycle.dispatchStreamEvent({
          type: "error",
          message: tRef.current("session.notConfigured"),
        })
        return
      }
      // Raw attachments ride alongside the flattened content so the in-process
      // `start_import` tool can stage their bytes — the content itself inlines
      // text files and base64-encodes images past reconstruction.
      session.send(content, allFiles).catch((err) => {
        lifecycle.dispatchStreamEvent({
          type: "error",
          message: err instanceof Error ? err.message : tRef.current("session.sendFailed"),
        })
      })
    },
    [ensureSession, lifecycle],
  )

  const stopStreaming = useCallback(() => {
    const session = lifecycle.sessionRef.current
    session?.stop()
    // Hand the chat history to the adapter so Claude CLI can synthesize
    // a `[Previous conversation]` recovery prefix on its next send.
    // API adapters keep their own messages array and treat this as a
    // no-op (the method is optional on the interface).
    session?.markInterrupted?.(messagesRef.current)
    lifecycle.setIsStreaming(false)

    // Replace empty in-flight assistant bubble or append separator
    const interruptBlock = { type: "text" as const, content: tRef.current("session.interrupted") }
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === "assistant" && last.blocks.length === 0) {
        const updated = [...prev]
        updated[updated.length - 1] = { ...last, blocks: [interruptBlock] }
        return updated
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant" as const, blocks: [interruptBlock] },
      ]
    })

    if (hadMutationsRef.current && ackedToolCallsRef.current.size === 0) {
      lifecycle.optsRef.current.onDataChanged?.()
    }
    hadMutationsRef.current = false
    ackedToolCallsRef.current = new Set()
  }, [lifecycle])

  return { messages, isStreaming: lifecycle.isStreaming, sendMessage, stopStreaming, newChat: resetConversation }
}
