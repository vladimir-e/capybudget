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

  // Track the last text content to detect cumulative text growth vs new text blocks
  const lastTextContentRef = useRef("")

  // Stable reference to options
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "content": {
        // Pure append-only: never replace existing blocks.
        // Text blocks: update last text block in-place if it's cumulative growth.
        // Everything else: always append.
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") return prev

          const blocks = [...last.blocks]

          for (const block of event.blocks) {
            if (block.type === "text") {
              const prevText = lastTextContentRef.current
              // Cumulative text growth — update last text block in place
              if (prevText && block.content.startsWith(prevText)) {
                const lastTextIdx = findLastIndex(blocks, (b) => b.type === "text")
                if (lastTextIdx >= 0) {
                  blocks[lastTextIdx] = block
                } else {
                  blocks.push(block)
                }
              } else {
                // New text block (new sub-message or first text)
                blocks.push(block)
              }
              lastTextContentRef.current = block.content
            } else {
              // Non-text blocks: always append
              blocks.push(block)
            }
          }

          updated[updated.length - 1] = { ...last, blocks }
          return updated
        })

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
        lastTextContentRef.current = ""
        if (hadMutationsRef.current) {
          hadMutationsRef.current = false
          optsRef.current.onDataChanged?.()
        }
        break

      case "error":
        setIsStreaming(false)
        hadMutationsRef.current = false
        lastTextContentRef.current = ""
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
          lastTextContentRef.current = ""
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
      lastTextContentRef.current = ""

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
    lastTextContentRef.current = ""
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
    lastTextContentRef.current = ""
  }, [])

  return { messages, isStreaming, sendMessage, stopStreaming, newChat }
}

// Array.findLastIndex polyfill (not available in all targets)
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}
