import { useRef, useEffect, useState, type KeyboardEvent } from "react"
import { RotateCcw, Send, Settings2, Sparkles, Square, X, Wrench } from "lucide-react"
import { CommandPicker } from "./command-picker"
import { InstructionsDialog } from "./instructions-dialog"
import { getToolLabel } from "@/services/capy-stream"
import type {
  ChatMessage,
  ContentBlock,
  BarChartBlock,
  DonutChartBlock,
  TableBlock,
} from "@capybudget/intelligence"

interface CapyOverlayProps {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  isStreaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  onNewChat: () => void
  instructions: string
  onSaveInstructions: (text: string) => Promise<void>
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
}: CapyOverlayProps) {
  const [input, setInput] = useState("")
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    onSend(text)
    setInput("")
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const lastMsg = messages[messages.length - 1]
  const showThinking = isStreaming && lastMsg?.role === "assistant" && lastMsg.blocks.length === 0

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col transition-all duration-300 ease-out ${
        open
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Backdrop — the app bleeds through */}
      <div
        className="absolute inset-0 bg-background/85 backdrop-blur-lg"
        onClick={onClose}
      />

      {/* Chat column */}
      <div
        className={`relative flex flex-1 flex-col mx-auto w-full max-w-3xl overflow-hidden transition-all duration-300 ease-out ${
          open ? "translate-y-0 scale-100" : "-translate-y-6 scale-[0.98]"
        }`}
      >
        {/* Overlay header */}
        <div className="flex items-center justify-between px-6 pt-16 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Sparkles className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground leading-tight">
                Capy
              </h2>
              <p className="text-xs text-muted-foreground">
                Your financial assistant
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setInstructionsOpen(true)}
              className="rounded-xl p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Custom instructions"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={onNewChat}
                className="rounded-xl px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center gap-1.5"
                aria-label="New chat"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                New Chat
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Close Capy"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 pb-4 capy-scroll"
        >
          <div className="space-y-5 py-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand mb-4">
                  <Sparkles className="h-7 w-7" />
                </div>
                <p className="text-lg font-medium text-foreground/80">
                  Ask me anything about your finances
                </p>
                <p className="mt-1 text-sm text-muted-foreground/60">
                  Spending breakdowns, categorization, trends, and more
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {showThinking && (
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

        {/* Input */}
        <div className="px-6 pb-8 pt-2">
          <div className="relative rounded-2xl border border-border/50 bg-card/80 shadow-2xl backdrop-blur-sm">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Capy anything about your finances..."
              rows={3}
              className="w-full resize-none rounded-2xl bg-transparent px-5 py-4 pr-14 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="absolute right-3 bottom-3 rounded-xl p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Stop response"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim()}
                className="absolute right-3 bottom-3 rounded-xl p-2.5 text-brand hover:bg-brand/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1">
            <CommandPicker onSelect={setInput} />
            <p className="text-xs text-muted-foreground/40">
              Shift + Enter for new line
            </p>
          </div>
        </div>
      </div>

      <InstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        instructions={instructions}
        onSave={onSaveInstructions}
      />
    </div>
  )
}

/* ── Message Bubble ───────────────────────────────────────────── */

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`space-y-4 ${
          isUser
            ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand/12 px-5 py-4"
            : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted/40 px-5 py-4"
        }`}
      >
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} isUser={isUser} />
        ))}
      </div>
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
          {block.content}
        </p>
      )
    case "table":
      return <TableView headers={block.headers} rows={block.rows} />
    case "bar-chart":
      return <BarChart title={block.title} data={block.data} />
    case "donut-chart":
      return <DonutChart title={block.title} data={block.data} />
    case "tool-activity":
      return <ToolActivity tool={block.tool} />
  }
}

/* ── Tool Activity ────────────────────────────────────────────── */

function ToolActivity({ tool }: { tool: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
      <Wrench className="h-3 w-3" />
      <span>{getToolLabel(tool)}</span>
    </div>
  )
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
