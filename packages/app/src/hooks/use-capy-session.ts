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

const CONTEXT_MAX_CHARS = 5000

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

/** Serialize chat messages into a text summary for context forwarding. */
function serializeConversation(messages: ChatMessage[], maxChars: number): string {
  const lines: string[] = []

  for (const msg of messages) {
    const role = msg.role === "user" ? "User" : "Capy"
    for (const block of msg.blocks) {
      if (block.type === "text") {
        lines.push(`${role}: ${block.content}`)
      } else if (block.type === "tool-activity") {
        lines.push(`[Tool: ${block.tool}]`)
      }
      // Skip tables/charts — too verbose for context
    }
  }

  let text = lines.join("\n")
  if (text.length > maxChars) {
    text = "...\n" + text.slice(-maxChars)
  }
  return text
}

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const sessionRef = useRef<CapySession | null>(null)
  const hadMutationsRef = useRef(false)
  const lastTextContentRef = useRef("")
  const sessionInterruptedRef = useRef(false)

  // Keep a ref to current messages for context serialization on stop recovery
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  // Stable reference to options
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "content": {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") return prev

          const blocks = [...last.blocks]

          for (const block of event.blocks) {
            if (block.type === "text") {
              const prevText = lastTextContentRef.current
              if (prevText && block.content.startsWith(prevText)) {
                const lastTextIdx = findLastIndex(blocks, (b) => b.type === "text")
                if (lastTextIdx >= 0) {
                  blocks[lastTextIdx] = block
                } else {
                  blocks.push(block)
                }
              } else {
                blocks.push(block)
              }
              lastTextContentRef.current = block.content
            } else {
              blocks.push(block)
            }
          }

          updated[updated.length - 1] = { ...last, blocks }
          return updated
        })

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
      const o = optsRef.current
      const context = buildContext({
        budgetName: o.budgetName,
        budgetPath: o.budgetPath,
      })

      // If recovering from an interrupted session, forward conversation context
      let enrichedMessage: string
      if (sessionInterruptedRef.current && messagesRef.current.length > 0) {
        const prevContext = serializeConversation(messagesRef.current, CONTEXT_MAX_CHARS)
        enrichedMessage = [
          context,
          "[Previous conversation — session was interrupted by user]",
          prevContext,
          "[Session was interrupted. This is a fresh session. The user may want to continue the conversation — pick up where you left off or ask for clarification if needed.]",
          "",
          text,
        ].join("\n")
        sessionInterruptedRef.current = false
      } else {
        enrichedMessage = `${context}\n${text}`
      }

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
    [ensureSession, handleStreamEvent],
  )

  const stopStreaming = useCallback(() => {
    sessionRef.current?.stop()
    setIsStreaming(false)
    lastTextContentRef.current = ""
    sessionInterruptedRef.current = true

    // Add visual separator
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        blocks: [{ type: "text", content: "Session interrupted. Send a message to continue." }],
      },
    ])

    if (hadMutationsRef.current) {
      hadMutationsRef.current = false
      optsRef.current.onDataChanged?.()
    }
  }, [])

  const newChat = useCallback(() => {
    sessionRef.current?.restart()
    sessionRef.current = null
    setMessages([])
    setIsStreaming(false)
    hadMutationsRef.current = false
    lastTextContentRef.current = ""
    sessionInterruptedRef.current = false
  }, [])

  return { messages, isStreaming, sendMessage, stopStreaming, newChat }
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}
