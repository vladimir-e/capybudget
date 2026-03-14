/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Lazy-spawns Claude CLI on first message
 * - Parses streaming events into ChatMessage[]
 * - Handles session restart on crash or "New Chat"
 * - Detects mutation tool calls and notifies for cache invalidation
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CapySession } from "@/services/capy-session"
import { parseStreamLine } from "@/services/capy-stream"
import {
  buildContext,
  SYSTEM_PROMPT,
  type SessionEvent,
  type StreamEvent,
  type ChatMessage,
} from "@capybudget/intelligence"

const MUTATION_TOOLS = new Set([
  "create_transaction",
  "update_transaction",
  "delete_transactions",
  "create_account",
  "update_account",
  "delete_account",
  "archive_account",
  "create_category",
  "update_category",
  "delete_category",
  "archive_category",
  "assign_categories",
])

interface UseCapySessionOptions {
  budgetPath: string
  budgetName: string
  mcpServerPath: string
  customInstructions?: string
  onDataChanged?: () => void
}

interface UseCapySessionReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  sendMessage: (text: string) => void
  stopStreaming: () => void
  newChat: () => void
}

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const sessionRef = useRef<CapySession | null>(null)
  const hadMutationsRef = useRef(false)

  // Track sub-message boundaries within a single assistant turn.
  // Claude CLI sends multiple sub-messages (text → tool call → tool result → text),
  // each starting with a fresh cumulative block array. We detect when a new sub-message
  // starts (block count drops) and append rather than replace.
  const committedBlocksRef = useRef(0)
  const prevEventBlockCountRef = useRef(0)

  // Stable reference to options
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "content": {
        // Detect sub-message boundary: block count dropping means a new sub-message
        // started with its own fresh cumulative block array.
        const isNewSubMessage =
          event.blocks.length < prevEventBlockCountRef.current
        prevEventBlockCountRef.current = event.blocks.length

        if (isNewSubMessage) {
          // Finalize previous sub-message blocks and append new ones
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role !== "assistant") return prev

            committedBlocksRef.current = last.blocks.length
            updated[updated.length - 1] = {
              ...last,
              blocks: [...last.blocks, ...event.blocks],
            }
            return updated
          })
        } else {
          // Cumulative update within the same sub-message:
          // keep committed blocks, replace the rest with the latest cumulative snapshot
          const committed = committedBlocksRef.current
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role !== "assistant") return prev

            updated[updated.length - 1] = {
              ...last,
              blocks: [...last.blocks.slice(0, committed), ...event.blocks],
            }
            return updated
          })
        }

        // Track if any mutation tools were called during this turn
        for (const block of event.blocks) {
          if (block.type === "tool-activity" && MUTATION_TOOLS.has(block.tool)) {
            hadMutationsRef.current = true
            break
          }
        }
        break
      }

      case "done":
        setIsStreaming(false)
        committedBlocksRef.current = 0
        prevEventBlockCountRef.current = 0
        if (hadMutationsRef.current) {
          hadMutationsRef.current = false
          optsRef.current.onDataChanged?.()
        }
        break

      case "error":
        setIsStreaming(false)
        hadMutationsRef.current = false
        committedBlocksRef.current = 0
        prevEventBlockCountRef.current = 0
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
  }, [])

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      switch (event.type) {
        case "stdout":
          for (const streamEvent of parseStreamLine(event.line)) {
            handleStreamEvent(streamEvent)
          }
          break

        case "stderr":
          console.debug("[capy-stderr]", event.line)
          break

        case "exit":
          // Unexpected exit — notify user
          setIsStreaming(false)
          hadMutationsRef.current = false
          committedBlocksRef.current = 0
          prevEventBlockCountRef.current = 0
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
          break

        case "error":
          handleStreamEvent({ type: "error", message: event.message })
          break
      }
    },
    [handleStreamEvent],
  )

  // Kill session on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.kill()
      sessionRef.current = null
    }
  }, [])

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      const o = optsRef.current
      const customInstructions = o.customInstructions?.trim()
      const systemPrompt = customInstructions
        ? `${SYSTEM_PROMPT}\n\n## User instructions\n${customInstructions}`
        : SYSTEM_PROMPT

      sessionRef.current = new CapySession({
        budgetPath: o.budgetPath,
        mcpServerPath: o.mcpServerPath,
        systemPrompt,
        onEvent: handleSessionEvent,
      })
    }
    return sessionRef.current
  }, [handleSessionEvent])

  const sendMessage = useCallback(
    (text: string) => {
      if (isStreaming) return

      const o = optsRef.current
      const context = buildContext({
        budgetName: o.budgetName,
      })

      const enrichedMessage = `${context}\n${text}`

      // Push user message + empty assistant shell
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        blocks: [{ type: "text", content: text }],
      }
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        blocks: [],
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)
      hadMutationsRef.current = false
      committedBlocksRef.current = 0
      prevEventBlockCountRef.current = 0

      const session = ensureSession()
      session.send(enrichedMessage).catch((err) => {
        handleStreamEvent({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to send message",
        })
      })
    },
    [isStreaming, ensureSession, handleStreamEvent],
  )

  const stopStreaming = useCallback(() => {
    if (!isStreaming) return
    sessionRef.current?.stop()
    setIsStreaming(false)
    committedBlocksRef.current = 0
    prevEventBlockCountRef.current = 0
    if (hadMutationsRef.current) {
      hadMutationsRef.current = false
      optsRef.current.onDataChanged?.()
    }
  }, [isStreaming])

  const newChat = useCallback(() => {
    sessionRef.current?.restart()
    sessionRef.current = null
    setMessages([])
    setIsStreaming(false)
    hadMutationsRef.current = false
    committedBlocksRef.current = 0
    prevEventBlockCountRef.current = 0
  }, [])

  return { messages, isStreaming, sendMessage, stopStreaming, newChat }
}
