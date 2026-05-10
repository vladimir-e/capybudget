/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Lazy-spawns Claude CLI on first message
 * - Parses streaming events into ChatMessage[]
 * - Handles session restart on crash or "New Chat"
 * - Detects mutation tool calls and notifies for cache invalidation
 * - On stop: forwards conversation context to the next session
 *
 * Stream contract: every adapter emits `StreamEvent.content` with the
 * **complete cumulative blocks array** for the current assistant turn —
 * never deltas. The hook replaces the trailing assistant message's
 * blocks wholesale on each event, so non-text blocks (tool-activity,
 * charts, attachments) never duplicate.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useSessionLifecycle } from "@/hooks/use-session-lifecycle"
import { mergeStreamContent } from "@/hooks/merge-stream-content"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import {
  buildContext,
  formatAttachments,
  isImageAttachment,
  SYSTEM_PROMPT,
  MUTATION_TOOL_NAMES,
  type FileAttachment,
  type MessageContent,
  type StreamEvent,
  type ChatMessage,
  type ContentBlock,
} from "@capybudget/intelligence"
import type { BudgetRepository, FileAdapter } from "@capybudget/persistence"

interface UseCapySessionOptions {
  budgetPath: string
  budgetName: string
  mcpServerPath: string
  customInstructions?: string
  onDataChanged?: () => void
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
          // Adapters emit the complete cumulative blocks array on
          // every event — `mergeStreamContent` replaces the trailing
          // assistant message's blocks wholesale. The pre-Phase-10.5b
          // append-each-block path duplicated tool cards, charts, and
          // attachments on every cumulative tick (demo regression).
          setMessages((prev) => mergeStreamContent(prev, event.blocks))

          for (const block of event.blocks) {
            if (block.type === "tool-activity" && MUTATION_TOOL_NAMES.has(block.tool)) {
              hadMutationsRef.current = true
              break
            }
          }
          break
        }

        case "done":
          ctx.setIsStreaming(false)
          if (hadMutationsRef.current) {
            hadMutationsRef.current = false
            ctx.optsRef.current.onDataChanged?.()
          }
          break

        case "error":
          ctx.setIsStreaming(false)
          hadMutationsRef.current = false
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role !== "assistant") {
              return [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  blocks: [{ type: "text" as const, content: `Error: ${event.message}` }],
                },
              ]
            }
            updated[updated.length - 1] = {
              ...last,
              blocks: [
                ...last.blocks,
                { type: "text" as const, content: `Error: ${event.message}` },
              ],
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
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          blocks: [
            {
              type: "text",
              content:
                "Session ended unexpectedly. Send a message to start a new conversation.",
            },
          ],
        },
      ])
    },
  )

  const ensureSession = useCallback(() => {
    if (!lifecycle.sessionRef.current) {
      const o = lifecycle.optsRef.current
      const customInstructions = o.customInstructions?.trim()
      const systemPrompt = customInstructions
        ? `${SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : SYSTEM_PROMPT

      lifecycle.createSession(systemPrompt)
    }
    return lifecycle.sessionRef.current
  }, [lifecycle])

  // When the user switches the provider to "off" (or away from any
  // configured provider), tear down any running session so we don't
  // keep a Claude CLI subprocess alive or an in-flight API request
  // running against the now-disabled provider.
  const provider = useIntelligenceStore((s) => s.config.provider)
  useEffect(() => {
    if (provider === "off") {
      lifecycle.cancel()
    }
  }, [provider, lifecycle])

  const sendMessage = useCallback(
    (text: string, files?: FileAttachment[]) => {
      if (lifecycle.isStreamingRef.current) return
      const o = lifecycle.optsRef.current
      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
      })

      const allFiles = files ?? []
      const imageFiles = allFiles.filter(isImageAttachment)
      const attachmentText = formatAttachments(allFiles)

      let enrichedText = `${context}\n${text}`
      if (attachmentText) {
        enrichedText += "\n\n" + attachmentText
      }

      // Build multimodal content when images are attached
      let content: MessageContent
      if (imageFiles.length > 0) {
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

      const session = ensureSession()
      if (!session) {
        // Intelligence is unconfigured (or the chosen provider isn't
        // available). Surface a single-turn error message and bail —
        // Round 4 will replace this with a proper empty-state CTA.
        lifecycle.dispatchStreamEvent({
          type: "error",
          message:
            "Capy is not configured. Open settings to pick an AI provider.",
        })
        return
      }
      session.send(content).catch((err) => {
        lifecycle.dispatchStreamEvent({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to send message",
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
    const interruptBlock = { type: "text" as const, content: "Session interrupted. Send a message to continue." }
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

    if (hadMutationsRef.current) {
      hadMutationsRef.current = false
      lifecycle.optsRef.current.onDataChanged?.()
    }
  }, [lifecycle])

  const newChat = useCallback(() => {
    lifecycle.cancel()
    setMessages([])
    hadMutationsRef.current = false
  }, [lifecycle])

  return { messages, isStreaming: lifecycle.isStreaming, sendMessage, stopStreaming, newChat }
}
