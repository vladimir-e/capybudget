/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Lazy-spawns Claude CLI on first message
 * - Parses streaming events into ChatMessage[]
 * - Handles session restart on crash or "New Chat"
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CapySession, type SessionEvent } from "@/services/capy-session"
import { parseStreamLine, type StreamEvent } from "@/services/capy-stream"
import { buildContext } from "@/services/capy-prompt"
import type { ChatMessage } from "@/components/capy/mock-data"

interface UseCapySessionOptions {
  budgetPath: string
  budgetName: string
  mcpServerPath: string
}

interface UseCapySessionReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  sendMessage: (text: string) => void
  newChat: () => void
}

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const sessionRef = useRef<CapySession | null>(null)
  // Track the latest text per assistant turn to handle cumulative replacement
  const currentTextRef = useRef("")

  // Stable reference to options for context enrichment
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "text":
        // Text is cumulative — replace the text block in the last assistant message
        currentTextRef.current = event.text
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") return prev

          const blocks = [...last.blocks]
          const textIdx = blocks.findIndex((b) => b.type === "text")
          const textBlock = { type: "text" as const, content: event.text }

          if (textIdx >= 0) {
            blocks[textIdx] = textBlock
          } else {
            // Insert text before any render blocks
            blocks.unshift(textBlock)
          }

          updated[updated.length - 1] = { ...last, blocks }
          return updated
        })
        break

      case "render":
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") return prev

          updated[updated.length - 1] = {
            ...last,
            blocks: [...last.blocks, event.block],
          }
          return updated
        })
        break

      case "tool-activity":
        // Could show a typing indicator with tool name — for now, no-op
        break

      case "done":
        setIsStreaming(false)
        currentTextRef.current = ""
        break

      case "error":
        setIsStreaming(false)
        currentTextRef.current = ""
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") {
            return [
              ...prev,
              {
                id: String(Date.now()),
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
          setMessages((prev) => [
            ...prev,
            {
              id: String(Date.now()),
              role: "assistant",
              blocks: [
                {
                  type: "text",
                  content:
                    "Session restarted — previous context was lost. You can continue chatting and I'll start fresh.",
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

  // Create session on mount, kill on unmount
  useEffect(() => {
    // Session is created lazily but we need the event handler ready
    return () => {
      sessionRef.current?.kill()
      sessionRef.current = null
    }
  }, [])

  const ensureSession = useCallback(() => {
    if (!sessionRef.current) {
      sessionRef.current = new CapySession({
        budgetPath: optsRef.current.budgetPath,
        mcpServerPath: optsRef.current.mcpServerPath,
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
        budgetPath: o.budgetPath,
        budgetName: o.budgetName,
      })

      const enrichedMessage = `${context}\n${text}`

      // Push user message + empty assistant shell
      const userMsg: ChatMessage = {
        id: String(Date.now()),
        role: "user",
        blocks: [{ type: "text", content: text }],
      }
      const assistantMsg: ChatMessage = {
        id: String(Date.now() + 1),
        role: "assistant",
        blocks: [],
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)
      currentTextRef.current = ""

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

  const newChat = useCallback(() => {
    sessionRef.current?.restart()
    sessionRef.current = null
    setMessages([])
    setIsStreaming(false)
    currentTextRef.current = ""
  }, [])

  return { messages, isStreaming, sendMessage, newChat }
}
