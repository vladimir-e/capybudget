/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Creates the provider's session lazily on the first message
 * - Parses streaming events into ChatMessage[]
 * - Rebuilds the session on "New Chat" or when its inputs change; custom
 *   instructions apply from the next chat
 * - Detects mutation tool calls and notifies for cache invalidation
 * - On stop: forwards conversation context to the next session
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle"
import { mergeStreamContent } from "@/hooks/merge-stream-content"
import { needsSecrets, useIntelligenceStore, type SecretsOutcome } from "@/stores/intelligence-store"
import {
  buildContext,
  canReadPdf,
  extractErrorMessage,
  formatAttachments,
  isImageAttachment,
  isPdfAttachment,
  sourceContentBlock,
  buildSystemPrompt,
  MUTATION_TOOL_NAMES,
  PROVIDER_LABELS,
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

interface PendingTurn {
  bubbleIds: readonly string[]
  handedOff: boolean
  carriesSnapshot: boolean
}

const NO_TURN: PendingTurn = { bubbleIds: [], handedOff: true, carriesSnapshot: false }

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const sendGenerationRef = useRef(0)
  const turnRef = useRef<PendingTurn>(NO_TURN)
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

  const endTurn = (rolledBack = false): PendingTurn => {
    const turn = turnRef.current
    turnRef.current = NO_TURN
    if (turn.carriesSnapshot && (rolledBack || !turn.handedOff)) snapshotSentRef.current = false
    return turn
  }

  const lifecycle = useSessionLifecycle(
    opts,
    (event: StreamEvent, ctx) => {
      if (!ctx.current) {
        if (event.type === "tool-result" && event.ok && MUTATION_TOOL_NAMES.has(event.tool)) {
          ctx.optsRef.current.onDataChanged?.()
        }
        return
      }
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
          endTurn()
          ctx.setIsStreaming(false)
          // Fallback: mutation was requested but no per-call ack landed.
          if (hadMutationsRef.current && ackedToolCallsRef.current.size === 0) {
            ctx.optsRef.current.onDataChanged?.()
          }
          hadMutationsRef.current = false
          ackedToolCallsRef.current = new Set()
          break

        case "error": {
          const turn = endTurn(event.rolledBack)
          ctx.setIsStreaming(false)
          hadMutationsRef.current = false
          ackedToolCallsRef.current = new Set()
          const unsentId = event.rolledBack ? turn.bubbleIds[0] : undefined
          setMessages((current) => {
            const prev = unsentId
              ? current.map((m) => (m.id === unsentId ? { ...m, unsent: true } : m))
              : current
            const errorBlock: ContentBlock = {
              type: "error",
              message: event.code
                ? tRef.current(`session.${event.code}`, {
                    provider: event.provider ? PROVIDER_LABELS[event.provider] : "",
                  })
                : event.message,
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

  // Read here (not just in the session signature below) so the prompt can bake
  // in whether this provider reads PDFs — a switch changes the signature and
  // rebuilds the session, so the prompt tracks the live capability.
  const provider = useIntelligenceStore((s) => s.config.provider)
  const pdfSupported = canReadPdf(provider)

  const ensureSession = useCallback(() => {
    if (!lifecycle.sessionRef.current) {
      const o = lifecycle.optsRef.current
      const basePrompt = buildSystemPrompt(o.currency, o.language, pdfSupported)
      const customInstructions = o.customInstructions?.trim()
      const systemPrompt = customInstructions
        ? `${basePrompt}\n\n## User instructions\n${customInstructions}`
        : basePrompt

      lifecycle.createSession(systemPrompt)
    }
    return lifecycle.sessionRef.current
  }, [lifecycle, pdfSupported])

  const cancelPendingSend = useCallback((): PendingTurn => {
    sendGenerationRef.current++
    const turn = turnRef.current
    turnRef.current = NO_TURN
    if (!turn.handedOff) useIntelligenceStore.getState().dismissSecretGate()
    return turn
  }, [])

  // Tear down the session and wipe the on-screen conversation. The session
  // bakes its adapter, model, and instructions in at creation, so a fresh
  // chat is the only honest reset — carrying old messages into a new session
  // would show a continuous thread the new model never actually saw.
  const resetConversation = useCallback(() => {
    cancelPendingSend()
    lifecycle.cancel()
    setMessages([])
    hadMutationsRef.current = false
    ackedToolCallsRef.current = new Set()
    snapshotSentRef.current = false
  }, [lifecycle, cancelPendingSend])

  // When the user changes provider or swaps the model within a provider,
  // start a fresh chat: the running session targets the old adapter/model and
  // has no memory of these turns anyway. Without the reset, `ensureSession()`
  // would either short-circuit on the still-populated `sessionRef` (routing
  // messages to the previous adapter) or spin up a new session under a thread
  // that visually implies continuity it doesn't have. `provider` is read above.
  const anthropicModel = useIntelligenceStore((s) => s.config.anthropic.model)
  const openaiModel = useIntelligenceStore((s) => s.config.openai.model)
  const claudeCliModel = useIntelligenceStore((s) => s.config.claudeCli.model)
  const ollamaModel = useIntelligenceStore((s) => s.config.ollama.model)
  const ollamaBaseUrl = useIntelligenceStore((s) => s.config.ollama.baseUrl)
  const anthropicKeyVersion = useIntelligenceStore((s) => s.secretsVersion.anthropic)
  const openaiKeyVersion = useIntelligenceStore((s) => s.secretsVersion.openai)
  const providerSignature =
    provider === "anthropic"
      ? `anthropic:${anthropicModel}:${anthropicKeyVersion}`
      : provider === "openai"
        ? `openai:${openaiModel}:${openaiKeyVersion}`
        : provider === "ollama"
          ? `ollama:${ollamaBaseUrl}:${ollamaModel}`
          : provider === "claude-cli"
            ? `claude-cli:${claudeCliModel}`
            : (provider ?? "off") // null carries no model — stable string signature
  // The key, currency, and language are baked into the session, so they join
  // the signature: a change rebuilds it.
  const sessionSignature = [providerSignature, `cur=${opts.currency}`, `lng=${opts.language ?? "en"}`].join(":")
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

  // Instructions are read when a session is created, so an edit reaches the
  // next chat. An empty chat has nothing to lose, so it rebuilds right away.
  const instructions = opts.customInstructions?.trim() ?? ""
  const prevInstructionsRef = useRef(instructions)
  useEffect(() => {
    if (prevInstructionsRef.current === instructions) return
    prevInstructionsRef.current = instructions
    if (messagesRef.current.length === 0 && !lifecycle.isStreamingRef.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      resetConversation()
    }
  }, [instructions, resetConversation, lifecycle])

  const sendMessage = useCallback(
    (text: string, files?: FileAttachment[]) => {
      if (lifecycle.isStreamingRef.current) return
      const generation = sendGenerationRef.current
      const o = lifecycle.optsRef.current
      const carriesSnapshot = !snapshotSentRef.current
      const snapshot = carriesSnapshot ? o.getBudgetSnapshot?.() : undefined
      snapshotSentRef.current = true
      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
        snapshot,
      })

      const allFiles = files ?? []
      // Images and PDFs ride as content blocks; text attachments (CSV, OFX) are
      // inlined by formatAttachments.
      const blockFiles = allFiles.filter((f) => isImageAttachment(f) || isPdfAttachment(f))
      const attachmentText = formatAttachments(allFiles)

      let enrichedText = `${context}\n${text}`
      if (attachmentText) {
        enrichedText += "\n\n" + attachmentText
      }

      const content: MessageContent =
        blockFiles.length > 0
          ? [{ type: "text", text: enrichedText }, ...blockFiles.map(sourceContentBlock)]
          : enrichedText

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
      const turn: PendingTurn = { bubbleIds: [userMsg.id, assistantMsg.id], handedOff: false, carriesSnapshot }
      turnRef.current = turn

      const fail = (message: string) => lifecycle.dispatchStreamEvent({ type: "error", message })

      const buildAndSend = (secrets: SecretsOutcome) => {
        if (generation !== sendGenerationRef.current) return
        if (needsSecrets(useIntelligenceStore.getState().config)) {
          fail(tRef.current(secrets === "dismissed" ? "session.keyAccessDismissed" : "session.keyReadFailed"))
          return
        }
        const session = ensureSession()
        if (!session) {
          fail(tRef.current("session.notConfigured"))
          return
        }
        turn.handedOff = true
        // Raw attachments ride alongside the flattened content so the in-process
        // `start_import` tool can stage their bytes — the content itself inlines
        // text files and base64-encodes images past reconstruction.
        session.send(content, allFiles).catch((err) => {
          if (lifecycle.sessionRef.current !== session) return
          const { message, status } = extractErrorMessage(err)
          lifecycle.dispatchStreamEvent({ type: "error", message: message || tRef.current("session.sendFailed"), status })
        })
      }

      // Fetch the API key on demand only when it isn't in memory yet — the
      // overlay pre-loads on open, so this is the safety net for a send that
      // races that load. When the key is already present (or the provider needs
      // none), build synchronously.
      const store = useIntelligenceStore.getState()
      if (needsSecrets(store.config)) {
        void store.ensureSecrets().then(buildAndSend)
      } else {
        buildAndSend("ready")
      }
    },
    [ensureSession, lifecycle],
  )

  const stopStreaming = useCallback(() => {
    const session = lifecycle.sessionRef.current
    const turn = cancelPendingSend()
    // A send still waiting on its key or queued behind a stopped round never
    // reaches the model, so its bubbles go rather than read as delivered.
    const neverSent = !turn.handedOff || session?.hasQueuedSend === true
    if (neverSent && turn.carriesSnapshot) snapshotSentRef.current = false
    session?.stop()
    lifecycle.setIsStreaming(false)

    if (neverSent) {
      setMessages((prev) => prev.filter((m) => !turn.bubbleIds.includes(m.id)))
    } else {
      // Hand the chat history to the adapter so Claude CLI can synthesize
      // a `[Previous conversation]` recovery prefix on its next send.
      // API adapters keep their own messages array and treat this as a
      // no-op (the method is optional on the interface).
      session?.markInterrupted?.(messagesRef.current)

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
    }

    if (hadMutationsRef.current && ackedToolCallsRef.current.size === 0) {
      lifecycle.optsRef.current.onDataChanged?.()
    }
    hadMutationsRef.current = false
    ackedToolCallsRef.current = new Set()
  }, [lifecycle, cancelPendingSend])

  return { messages, isStreaming: lifecycle.isStreaming, sendMessage, stopStreaming, newChat: resetConversation }
}
