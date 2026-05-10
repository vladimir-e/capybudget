import { useRef, useEffect, useState, useCallback, type KeyboardEvent, type ChangeEvent, type DragEvent, type RefObject } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  Check,
  CreditCard,
  File as FileIcon,
  Image,
  Loader2,
  PanelRightClose,
  Paperclip,
  PieChart,
  Receipt,
  RotateCcw,
  Send,
  Settings,
  Settings2,
  Square,
  TrendingUp,
  X,
} from "lucide-react"
import { toast } from "sonner"
import capyMascot from "@/assets/capy-neutral.webp"
import { CommandPicker } from "./command-picker"
import { InstructionsDialog } from "./instructions-dialog"
import { formatText } from "@/lib/format-text"
import { getToolLabel } from "@/lib/tool-labels"
import { useIntelligenceStore } from "@/stores/intelligence-store"
import { detectClaudeCli } from "@/services/claude-cli-detect"
import type { CapyCommand } from "@/hooks/use-custom-commands"
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  formatFileSize,
  type FileAttachment,
  type ChatMessage,
  type ContentBlock,
  type BarChartBlock,
  type DonutChartBlock,
  type FollowupChip,
  type IntelligenceProvider,
  type TableBlock,
  type ToolActivityBlock,
} from "@capybudget/intelligence"

interface CapyOverlayProps {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  isStreaming: boolean
  onSend: (text: string, files?: FileAttachment[]) => void
  onStop: () => void
  onNewChat: () => void
  instructions: string
  onSaveInstructions: (text: string) => Promise<void>
  commands: CapyCommand[]
  onSaveCommands: (commands: CapyCommand[]) => Promise<void>
}

export function CapyOverlay({
  open,
  onClose,
  messages,
  isStreaming,
  onSend,
  onStop,
  onNewChat,
  instructions,
  onSaveInstructions,
  commands,
  onSaveCommands,
}: CapyOverlayProps) {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const firstChipRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  // Intelligence config — used to decide whether to show the
  // "set up your AI assistant" empty state and to hide the input
  // entirely until a provider + key are configured.
  const navigate = useNavigate()
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
    navigate({ to: "/settings" })
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
      className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border/50 bg-background shadow-2xl transition-transform duration-200 ease-out sm:w-[440px] ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
      onDragEnter={isConfigured ? handleDragEnter : undefined}
      onDragLeave={isConfigured ? handleDragLeave : undefined}
      onDragOver={isConfigured ? handleDragOver : undefined}
      onDrop={isConfigured ? handleDrop : undefined}
    >
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
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
              <p className="truncate text-xs text-muted-foreground">
                Your financial assistant
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            disabled={messages.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            aria-label="New chat"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            aria-label="Hide panel"
            title="Hide panel"
          >
            <PanelRightClose className="h-4.5 w-4.5" />
          </button>
        </div>
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

/* ── Mascot hero ───────────────────────────────────────────────── */

function MascotHero() {
  return (
    <div
      className="relative mx-auto mb-6 flex h-28 w-28 items-center justify-center"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at center, color-mix(in oklab, var(--brand) 55%, transparent) 0%, color-mix(in oklab, var(--brand) 18%, transparent) 45%, transparent 75%)",
          filter: "blur(14px)",
        }}
      />
      <img
        src={capyMascot}
        alt=""
        className="relative h-24 w-24 rounded-full object-cover"
      />
    </div>
  )
}

/* ── Empty states ─────────────────────────────────────────────── */

interface UnconfiguredEmptyStateProps {
  claudeCliAvailable: boolean | null
  onPickProvider: (provider: IntelligenceProvider) => void
  onOpenSettings: () => void
  firstChipRef: RefObject<HTMLButtonElement | null>
}

const PROVIDER_CHIPS: ReadonlyArray<{ provider: IntelligenceProvider; label: string }> = [
  { provider: "claude-cli", label: "Claude Code" },
  { provider: "anthropic", label: "Anthropic" },
  { provider: "openai", label: "OpenAI" },
]

function UnconfiguredEmptyState({
  claudeCliAvailable,
  onPickProvider,
  onOpenSettings,
  firstChipRef,
}: UnconfiguredEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
      <MascotHero />
      <h3 className="text-lg font-semibold text-foreground">
        Set up your AI assistant
      </h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Capy needs an AI provider before it can help. Choose Claude Code,
        Anthropic, or OpenAI in settings.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {PROVIDER_CHIPS.map(({ provider, label }, idx) => {
          const isClaudeCli = provider === "claude-cli"
          // Disable the Claude Code chip while detection is pending (null)
          // and when the CLI is absent (false). Only `true` enables the
          // chip — otherwise a fast clicker can race-set provider on a
          // machine where the CLI isn't actually installed.
          const disabled = isClaudeCli && claudeCliAvailable !== true
          const title = disabled
            ? claudeCliAvailable === null
              ? "Checking for Claude Code CLI…"
              : "Claude Code CLI not detected on this machine"
            : undefined
          return (
            <button
              key={provider}
              type="button"
              ref={idx === 0 ? firstChipRef : undefined}
              onClick={() => onPickProvider(provider)}
              disabled={disabled}
              title={title}
              className="rounded-full border border-border/40 bg-muted/40 px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:bg-muted/40 disabled:hover:text-foreground/80"
            >
              {label}
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand/90"
      >
        <Settings className="h-4 w-4" />
        Open settings
      </button>
    </div>
  )
}

interface SuggestionCard {
  icon: typeof TrendingUp
  label: string
  prompt: string
}

const SUGGESTION_CARDS: ReadonlyArray<SuggestionCard> = [
  {
    icon: TrendingUp,
    label: "How am I doing this month?",
    prompt: "How am I doing this month?",
  },
  {
    icon: PieChart,
    label: "Where did my money go in 2025?",
    prompt: "Where did my money go in 2025?",
  },
  {
    icon: Receipt,
    label: "Find duplicate transactions",
    prompt: "Find duplicate transactions in my budget",
  },
  {
    icon: CreditCard,
    label: "Help me set a grocery budget",
    prompt: "Help me set a grocery budget",
  },
]

interface ConfiguredEmptyStateProps {
  onSuggestion: (prompt: string) => void
}

function ConfiguredEmptyState({ onSuggestion }: ConfiguredEmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-2 py-8 text-center">
      <MascotHero />
      <h3 className="text-lg font-semibold text-foreground">
        Hey, I&apos;m Capy.
      </h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        Ask me about your spending, budgets, or transactions. I see everything
        in this folder.
      </p>
      <div className="mt-6 grid w-full grid-cols-2 gap-2">
        {SUGGESTION_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <button
              key={card.prompt}
              type="button"
              onClick={() => onSuggestion(card.prompt)}
              className="group flex items-start gap-2.5 rounded-xl border border-border/40 bg-muted/30 p-3 text-left transition-colors hover:border-brand/40 hover:bg-brand/5"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand transition-colors group-hover:text-brand" />
              <span className="text-xs font-medium text-foreground/85 leading-snug">
                {card.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Message Bubble ───────────────────────────────────────────── */

/**
 * Render groups for a single message:
 *   - "bubble"  — runs of mixed content (text, tables, charts, file attachments)
 *                 rendered inside the chat bubble
 *   - "tools"   — runs of consecutive tool-activity blocks rendered as a
 *                 single grouped card (also inside the bubble — this gives
 *                 the persistent, design-mockup look)
 *   - "followups" — a `followups` block, rendered outside the bubble below
 *                   the message so the chips reflow at panel width
 *
 * Walking the blocks once and pre-grouping keeps the JSX tree flat and
 * avoids the "are these tool-activity blocks consecutive?" check from
 * leaking into BlockRenderer.
 */
type MessageGroup =
  | { kind: "bubble"; blocks: ContentBlock[] }
  | { kind: "tools"; blocks: ToolActivityBlock[]; trailing: boolean }
  | { kind: "followups"; chips: FollowupChip[] }

function groupBlocks(blocks: ContentBlock[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let bubble: ContentBlock[] = []
  let tools: ToolActivityBlock[] = []

  const flushBubble = () => {
    if (bubble.length > 0) {
      groups.push({ kind: "bubble", blocks: bubble })
      bubble = []
    }
  }
  const flushTools = (trailing: boolean) => {
    if (tools.length > 0) {
      groups.push({ kind: "tools", blocks: tools, trailing })
      tools = []
    }
  }

  for (const block of blocks) {
    if (block.type === "tool-activity") {
      flushBubble()
      tools.push(block)
    } else if (block.type === "followups") {
      flushBubble()
      flushTools(false)
      groups.push({ kind: "followups", chips: block.chips })
    } else {
      flushTools(false)
      bubble.push(block)
    }
  }
  // The trailing tool group is special: when the message is still
  // streaming, the last tool in this group is in-progress (spinner).
  flushTools(true)
  flushBubble()
  return groups
}

function MessageBubble({
  message,
  isStreaming,
  onSend,
}: {
  message: ChatMessage
  isStreaming: boolean
  onSend: (text: string) => void
}) {
  const isUser = message.role === "user"
  const groups = groupBlocks(message.blocks)

  return (
    <div className="space-y-3">
      {groups.map((group, gi) => {
        if (group.kind === "followups") {
          return <FollowupChips key={gi} chips={group.chips} onSend={onSend} disabled={isStreaming} />
        }

        return (
          <div key={gi} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
            <div
              className={
                isUser
                  ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand/12 px-5 py-4 space-y-4"
                  : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted/40 px-5 py-4 space-y-4"
              }
            >
              {group.kind === "bubble"
                ? group.blocks.map((block, i) => (
                    <BlockRenderer key={i} block={block} isUser={isUser} />
                  ))
                : (
                  <ToolGroupCard
                    blocks={group.blocks}
                    inProgress={isStreaming && group.trailing}
                  />
                )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Block Router ─────────────────────────────────────────────── */

function BlockRenderer({
  block,
  isUser,
}: {
  block: ContentBlock
  isUser: boolean
}) {
  switch (block.type) {
    case "text":
      return (
        <p
          className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
            isUser ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {formatText(block.content)}
        </p>
      )
    case "table":
      return <TableView headers={block.headers} rows={block.rows} />
    case "bar-chart":
      return <BarChart title={block.title} data={block.data} />
    case "donut-chart":
      return <DonutChart title={block.title} data={block.data} />
    case "tool-activity":
      // Grouped into ToolGroupCard by groupBlocks() before reaching
      // BlockRenderer.
      return null
    case "file-attachment":
      return <FileChip name={block.name} size={block.size} mediaType={block.mediaType} />
    case "followups":
      // Lifted out of the bubble by groupBlocks() and rendered as a
      // separate FollowupChips group.
      return null
  }
}

/* ── File Chip ────────────────────────────────────────────────── */

function FileChip({
  name,
  size,
  mediaType,
  onRemove,
}: {
  name: string
  size: number
  mediaType: string
  onRemove?: () => void
}) {
  const Icon = mediaType.startsWith("image/") ? Image : FileIcon
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1 text-xs text-foreground/70">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {name}
      <span className="text-muted-foreground/50">
        {formatFileSize(size)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}

/* ── File helpers ─────────────────────────────────────────────── */

const TEXT_EXTENSIONS = new Set([".csv", ".tsv", ".json", ".xml", ".md", ".txt", ".log"])

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true
  if (file.type === "application/json" || file.type === "application/xml") return true
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* ── Tool group card ──────────────────────────────────────────── */

/**
 * Grouped tool-progress card. Rows show the friendly label and a
 * status indicator: spinner for the in-progress row, checkmark for
 * completed rows. Renders even with one row (matches the design
 * mockup — every tool-activity sequence ends up in a card).
 */
function ToolGroupCard({
  blocks,
  inProgress,
}: {
  blocks: ToolActivityBlock[]
  inProgress: boolean
}) {
  return (
    <div className="rounded-xl bg-muted/40 px-3.5 py-2.5">
      <div className="flex flex-col gap-1.5">
        {blocks.map((block, i) => {
          const isLast = i === blocks.length - 1
          const isCurrent = inProgress && isLast
          return (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-muted-foreground/80"
            >
              {isCurrent ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
              ) : (
                <Check className="h-3.5 w-3.5 shrink-0 text-brand/80" />
              )}
              <span>{getToolLabel(block.tool)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Follow-up chips ──────────────────────────────────────────── */

function FollowupChips({
  chips,
  onSend,
  disabled,
}: {
  chips: FollowupChip[]
  onSend: (text: string) => void
  disabled: boolean
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSend(chip.prompt)}
          disabled={disabled}
          className="rounded-full border border-border/40 bg-muted/40 px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-brand/40 hover:bg-brand/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/40 disabled:hover:bg-muted/40 disabled:hover:text-foreground/80"
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

/* ── Helpers ──────────────────────────────────────────────────── */

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

/* ── Table ─────────────────────────────────────────────────────── */

function TableView({ headers, rows }: Pick<TableBlock, "headers" | "rows">) {
  return (
    <div className="rounded-xl border border-border/30 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/20">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-2.5 text-foreground/80 ${
                    cell.startsWith("-$")
                      ? "text-amount-expense font-medium tabular-nums"
                      : cell.startsWith("$")
                        ? "text-amount-income font-medium tabular-nums"
                        : ""
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Bar Chart ─────────────────────────────────────────────────── */

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function BarChart({ title, data }: Pick<BarChartBlock, "title" | "data">) {
  if (data.length === 0) return null
  const max = Math.max(...data.map((d) => d.value))
  if (max === 0) return null

  return (
    <div className="rounded-xl border border-border/30 bg-card/40 p-5">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        {title}
      </h4>
      <div className="space-y-3">
        {data.map((d, i) => (
          <div key={d.label} className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-foreground/80">{d.label}</span>
              <span className="font-medium tabular-nums text-foreground/70">
                ${d.value.toFixed(2)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${(d.value / max) * 100}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Donut Chart ───────────────────────────────────────────────── */

function DonutChart({ title, data }: Pick<DonutChartBlock, "title" | "data">) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (data.length === 0 || total === 0) return null
  const size = 140
  const cx = size / 2
  const cy = size / 2
  const outerR = 58
  const innerR = 36

  // Pre-compute cumulative start angles to avoid mutable state in render
  const sweeps = data.map((d) => (d.value / total) * 360)
  const startAngles = sweeps.reduce<number[]>(
    (acc, sweep) => [...acc, acc[acc.length - 1] + sweep],
    [-90],
  )

  const slices = data.map((d, i) => {
    const startDeg = startAngles[i]
    const sweep = sweeps[i]
    const startRad = (startDeg * Math.PI) / 180
    const endRad = ((startDeg + sweep) * Math.PI) / 180

    const x1 = cx + outerR * Math.cos(startRad)
    const y1 = cy + outerR * Math.sin(startRad)
    const x2 = cx + outerR * Math.cos(endRad)
    const y2 = cy + outerR * Math.sin(endRad)
    const ix1 = cx + innerR * Math.cos(startRad)
    const iy1 = cy + innerR * Math.sin(startRad)
    const ix2 = cx + innerR * Math.cos(endRad)
    const iy2 = cy + innerR * Math.sin(endRad)

    const large = sweep > 180 ? 1 : 0
    const path = [
      `M ${x1} ${y1}`,
      `A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2}`,
      `L ${ix2} ${iy2}`,
      `A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1}`,
      "Z",
    ].join(" ")

    return {
      path,
      color: CHART_COLORS[i % CHART_COLORS.length],
      label: d.label,
      pct: ((d.value / total) * 100).toFixed(0),
      value: d.value,
    }
  })

  return (
    <div className="rounded-xl border border-border/30 bg-card/40 p-5">
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
        {title}
      </h4>
      <div className="flex items-center gap-6">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="shrink-0"
        >
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} opacity={0.85} />
          ))}
          {/* Center label */}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="fill-foreground text-lg font-semibold"
            style={{ fontSize: 18 }}
          >
            ${total.toFixed(0)}
          </text>
          <text
            x={cx}
            y={cy + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 10 }}
          >
            total
          </text>
        </svg>
        <div className="space-y-2 min-w-0">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 text-sm">
              <div
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-foreground/80 truncate">{s.label}</span>
              <span className="text-muted-foreground tabular-nums ml-auto shrink-0">
                {s.pct}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
