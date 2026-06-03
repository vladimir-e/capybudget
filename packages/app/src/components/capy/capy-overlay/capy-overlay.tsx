import { useRef, useEffect, useState, useCallback, type KeyboardEvent, type ChangeEvent, type DragEvent } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  PanelRightClose,
  Paperclip,
  RotateCcw,
  Send,
  Settings2,
  Square,
} from "lucide-react"
import { toast } from "sonner"
import capyMascot from "@/assets/capy-neutral.webp"
import { CommandPicker } from "../command-picker"
import { InstructionsDialog } from "../instructions-dialog"
import { isTextFile, readFileAsBase64 } from "@/lib/file-attachments"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { detectClaudeCli } from "@/services/claude-cli-detect"
import type { CapyCommand } from "@/hooks/use-custom-commands"
import { useMediaQuery, usePanelResize } from "@/hooks/use-panel-resize"
import { useCapySessionContext } from "@/contexts/capy-session-context"
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  PROVIDER_LABELS,
  type FileAttachment,
  type ChatMessage,
  type IntelligenceProvider,
} from "@capybudget/intelligence"
import { ConfiguredEmptyState, UnconfiguredEmptyState } from "./capy-empty-states"
import { MessageBubble } from "./capy-message-bubble"
import { FileChip } from "./file-chip"

// Panel sizing — the desktop default and lower bound. Below `sm:`
// the panel goes full-width and the resize handle is hidden, which
// preserves the mobile layout for the web demo.
const PANEL_MIN_WIDTH = 440
const PANEL_MAX_WIDTH_CAP = 720
const PANEL_WIDTH_STORAGE_KEY = "capy-panel-width"

function panelMaxWidth(win: Window): number {
  return Math.min(win.innerWidth * 0.5, PANEL_MAX_WIDTH_CAP)
}

interface CapyOverlayProps {
  instructions: string
  onSaveInstructions: (text: string) => Promise<void>
  commands: CapyCommand[]
  onSaveCommands: (commands: CapyCommand[]) => Promise<void>
}

export function CapyOverlay({
  instructions,
  onSaveInstructions,
  commands,
  onSaveCommands,
}: CapyOverlayProps) {
  const {
    open,
    setOpen,
    messages,
    isStreaming,
    sendMessage: onSend,
    stopStreaming: onStop,
    newChat: onNewChat,
  } = useCapySessionContext()
  const onClose = useCallback(() => setOpen(false), [setOpen])
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const firstChipRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  // Resize: only on `sm:` and up — mobile keeps the full-width design
  // used by the demo. The drag handle is hidden below the breakpoint.
  const isResizable = useMediaQuery("(min-width: 640px)")
  const resize = usePanelResize({
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: panelMaxWidth,
    storageKey: PANEL_WIDTH_STORAGE_KEY,
  })

  // Intelligence config — used to decide whether to show the
  // "set up your AI assistant" empty state and to hide the input
  // entirely until a provider + key are configured. `null` is the
  // explicit opt-out and behaves like an unconfigured provider.
  const navigate = useNavigate()
  const { path, name } = useSearch({ from: "/budget" })
  const config = useIntelligenceStore((s) => s.config)
  const setProvider = useIntelligenceStore((s) => s.setProvider)
  const isConfigured =
    config.provider === "claude-cli" ||
    (config.provider === "anthropic" && !!config.anthropic.apiKey) ||
    (config.provider === "openai" && !!config.openai.apiKey)

  // Detect Claude Code CLI on mount so we can disable that chip when it
  // isn't installed. detectClaudeCli is cached and idempotent — repeat
  // calls are cheap.
  const [claudeCliAvailable, setClaudeCliAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    detectClaudeCli()
      .then((available) => {
        if (!cancelled) setClaudeCliAvailable(available)
      })
      .catch(() => {
        if (!cancelled) setClaudeCliAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openSettings(provider?: IntelligenceProvider) {
    if (provider) setProvider(provider)
    onClose()
    navigate({ to: "/budget/settings", search: { path, name } })
  }

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        // Focus the textarea when configured; otherwise focus the first
        // enabled provider chip so keyboard users don't lose focus —
        // textarea is hidden in the unconfigured state, and the Claude
        // chip may be disabled while detection resolves or when the
        // CLI is missing. If the first chip is disabled, fall back
        // to the next chip; ultimately the focus call no-ops if the
        // DOM target isn't yet attached, which is fine.
        if (isConfigured) {
          inputRef.current?.focus()
        } else {
          const chip = firstChipRef.current
          if (chip && !chip.disabled) {
            chip.focus()
          } else {
            chip?.parentElement
              ?.querySelector<HTMLButtonElement>("button:not([disabled])")
              ?.focus()
          }
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open, isConfigured])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const processFiles = useCallback(async (files: File[]) => {
    // Phase 1: read files (no state dependency)
    const candidates: FileAttachment[] = []
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`${file.name} exceeds 5MB limit`)
        continue
      }
      const isImage = file.type.startsWith("image/")
      if (!isImage && !isTextFile(file)) {
        toast.error(`${file.name} is not a supported file type`)
        continue
      }
      const content = isImage ? await readFileAsBase64(file) : await file.text()
      candidates.push({
        name: file.name,
        content,
        size: file.size,
        mediaType: file.type || "text/plain",
      })
    }

    // Phase 2: validate totals against actual state (avoids stale closure)
    if (candidates.length > 0) {
      setAttachments((prev) => {
        let runningTotal = prev.reduce((s, a) => s + a.size, 0)
        const accepted: FileAttachment[] = []
        for (const c of candidates) {
          if (runningTotal + c.size > MAX_TOTAL_ATTACHMENT_SIZE) {
            toast.error("Total attachment size exceeds 10MB")
            break
          }
          accepted.push(c)
          runningTotal += c.size
        }
        return accepted.length > 0 ? [...prev, ...accepted] : prev
      })
    }
  }, [])

  const handleSend = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isStreaming) return
    onSend(text, attachments.length > 0 ? attachments : undefined)
    setInput("")
    setAttachments([])
  }

  const handleSuggestion = (prompt: string) => {
    if (isStreaming) return
    onSend(prompt)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    await processFiles(files)
  }

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    await processFiles(files)
  }, [processFiles])

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <aside
      aria-label="Capy assistant"
      inert={!open}
      style={isResizable ? { width: `${resize.width}px` } : undefined}
      className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border/50 bg-background shadow-2xl transition-transform duration-200 ease-out ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      } ${resize.isDragging ? "select-none" : ""}`}
      onDragEnter={isConfigured ? handleDragEnter : undefined}
      onDragLeave={isConfigured ? handleDragLeave : undefined}
      onDragOver={isConfigured ? handleDragOver : undefined}
      onDrop={isConfigured ? handleDrop : undefined}
    >
      {/* Drag handle — left edge, sm+ only. Thin strip with a wider
          hit-target via padding; the visible band lives at left:0. */}
      {isResizable && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Capy panel"
          onPointerDown={resize.onPointerDown}
          className={`absolute inset-y-0 left-0 z-30 w-1 cursor-ew-resize bg-transparent transition-colors hover:bg-brand/30 ${
            resize.isDragging ? "bg-brand/40" : ""
          }`}
        />
      )}
      {/* Drop zone indicator — only when configured (drag handlers are gated too) */}
      {isConfigured && isDragging && (
        <div className="absolute inset-4 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand/50 bg-brand/5 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-brand">
            <Paperclip className="h-6 w-6" />
            <p className="text-sm font-medium">Drop files here</p>
          </div>
        </div>
      )}

      {/* Persistent header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={capyMascot}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">
              Capy
            </h2>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isConfigured ? "bg-green-500" : "bg-muted-foreground/40"
                }`}
                aria-hidden="true"
              />
              <p className="truncate text-xs text-muted-foreground">
                {isConfigured && config.provider
                  ? PROVIDER_LABELS[config.provider]
                  : "Not configured"}
              </p>
            </div>
          </div>
        </div>
        {/* Collapse sits alone in the corner — an easy, uncrowded tap target
            roughly where the launcher was (New chat moved to the composer). */}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-2.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Hide panel"
          title="Hide panel"
        >
          <PanelRightClose className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 pb-4 capy-scroll"
      >
        <div className="space-y-5 py-4">
          {messages.length === 0 && !isConfigured && (
            <UnconfiguredEmptyState
              claudeCliAvailable={claudeCliAvailable}
              onPickProvider={openSettings}
              onOpenSettings={() => openSettings()}
              firstChipRef={firstChipRef}
            />
          )}
          {messages.length === 0 && isConfigured && (
            <ConfiguredEmptyState onSuggestion={handleSuggestion} />
          )}
          {messages.map((msg, i) => {
            // Only the trailing assistant message can be "still streaming";
            // earlier messages are settled history. Tool-progress cards
            // and the in-progress spinner only appear on this turn.
            const isLastAssistant =
              msg.role === "assistant" && i === messages.length - 1
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming && isLastAssistant}
                onSend={onSend}
              />
            )
          })}
          {isStreaming && lastMessageHasNoBlocks(messages) && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-sm bg-muted/40 px-5 py-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="capy-thinking flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand/60" />
                    <span className="h-1.5 w-1.5 rounded-full bg-brand/60" />
                    <span className="h-1.5 w-1.5 rounded-full bg-brand/60" />
                  </div>
                  Thinking...
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input — hidden entirely until a provider is configured. The
          unconfigured state is mascot + chips + Open settings only. */}
      {isConfigured && (
        <div className="px-5 pb-5 pt-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <div className="relative rounded-2xl border border-border/50 bg-card/80 shadow-overlay backdrop-blur-sm">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-5 pt-3.5 pb-0">
                {attachments.map((att, i) => (
                  <FileChip
                    key={i}
                    name={att.name}
                    size={att.size}
                    mediaType={att.mediaType}
                    onRemove={() => removeAttachment(i)}
                  />
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Capy anything about your finances..."
              rows={3}
              className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 pr-14 pl-12 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <div className="absolute left-3 bottom-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-xl p-2.5 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                aria-label="Attach file"
              >
                <Paperclip className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="absolute right-3 bottom-3 flex items-center gap-1">
              {isStreaming && (
                <button
                  type="button"
                  onClick={onStop}
                  className="rounded-xl p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  aria-label="Stop response"
                >
                  <Square className="h-4 w-4 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  (!input.trim() && attachments.length === 0) ||
                  isStreaming
                }
                className="rounded-xl p-2.5 text-brand hover:bg-brand/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <CommandPicker commands={commands} onSelect={setInput} onSave={onSaveCommands} />
              <button
                type="button"
                onClick={() => setInstructionsOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
                aria-label="Custom instructions"
              >
                <Settings2 className="h-3 w-3" />
                Instructions
              </button>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={onNewChat}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
                  aria-label="New chat"
                >
                  <RotateCcw className="h-3 w-3" />
                  New chat
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground/40">
              Shift + Enter for new line
            </p>
          </div>
        </div>
      )}

      <InstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        instructions={instructions}
        onSave={onSaveInstructions}
      />
    </aside>
  )
}

/**
 * True when the last message is an assistant turn with no blocks yet.
 * Used to gate the "Thinking..." indicator — once the first content
 * block lands the bubble itself shows progress (text streaming in,
 * tool group with spinner).
 */
function lastMessageHasNoBlocks(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1]
  return !!last && last.role === "assistant" && last.blocks.length === 0
}
