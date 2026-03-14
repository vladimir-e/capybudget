/**
 * React hook managing the Capy AI session lifecycle and message state.
 *
 * - Lazy-spawns Claude CLI on first message
 * - Parses streaming events into ChatMessage[]
 * - Handles session restart on crash or "New Chat"
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { CapySession } from "@/services/capy-session"
import { parseStreamLine } from "@/services/capy-stream"
import {
  buildContext,
  type SessionEvent,
  type StreamEvent,
  type ChatMessage,
} from "@capybudget/intelligence"

interface UseCapySessionOptions {
  budgetPath: string
  budgetName: string
  mcpServerPath: string
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

  // Stable reference to options for context enrichment
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const handleStreamEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "content":
        // Replace all blocks on the last assistant message from the cumulative message
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role !== "assistant") return prev

          updated[updated.length - 1] = { ...last, blocks: event.blocks }
          return updated
        })
        break

      case "done":
        setIsStreaming(false)
        break

      case "error":
        setIsStreaming(false)
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
  }, [isStreaming])

  const newChat = useCallback(() => {
    sessionRef.current?.restart()
    sessionRef.current = null
    setMessages([])
    setIsStreaming(false)
  }, [])

  return { messages, isStreaming, sendMessage, stopStreaming, newChat }
}
