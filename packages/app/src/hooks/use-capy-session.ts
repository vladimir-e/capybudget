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
  MUTATION_TOOL_NAMES,
  type SessionEvent,
  type StreamEvent,
  type ChatMessage,
} from "@capybudget/intelligence"
import { serializeConversation } from "@/services/serialize-conversation"

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

export function useCapySession(opts: UseCapySessionOptions): UseCapySessionReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, _setIsStreaming] = useState(false)
  const isStreamingRef = useRef(false)
  const sessionRef = useRef<CapySession | null>(null)
  const hadMutationsRef = useRef(false)
  const lastTextContentRef = useRef("")
  const sessionInterruptedRef = useRef(false)

  // Keep ref and state in sync so callbacks can check without stale closures
  const setIsStreaming = useCallback((value: boolean) => {
    isStreamingRef.current = value
    _setIsStreaming(value)
  }, [])

  // Keep refs to current values for use in callbacks without stale closures
  const messagesRef = useRef(messages)
  const optsRef = useRef(opts)
  useEffect(() => {
    messagesRef.current = messages
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
                const lastTextIdx = blocks.findLastIndex((b) => b.type === "text")
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
          if (block.type === "tool-activity" && MUTATION_TOOL_NAMES.has(block.tool)) {
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
  }, [setIsStreaming])

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
    [handleStreamEvent, setIsStreaming],
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
      if (isStreamingRef.current) return
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
    [ensureSession, handleStreamEvent, setIsStreaming],
  )

  const stopStreaming = useCallback(() => {
    sessionRef.current?.stop()
    setIsStreaming(false)
    lastTextContentRef.current = ""
    sessionInterruptedRef.current = true

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
      optsRef.current.onDataChanged?.()
    }
  }, [setIsStreaming])

  const newChat = useCallback(() => {
    sessionRef.current?.restart()
    sessionRef.current = null
    setMessages([])
    setIsStreaming(false)
    hadMutationsRef.current = false
    lastTextContentRef.current = ""
    sessionInterruptedRef.current = false
  }, [setIsStreaming])

  return { messages, isStreaming, sendMessage, stopStreaming, newChat }
}
