import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react"
import { open as shellOpen } from "@tauri-apps/plugin-shell"
import { getToolLabel } from "@/lib/tool-labels"
import { billingCtaUrl } from "@/lib/billing-cta"
import type {
  ChatMessage,
  ContentBlock,
  ErrorBlock,
  FollowupChip,
  ToolActivityBlock,
} from "@capybudget/intelligence"
import { BlockRenderer } from "./capy-block-renderer"

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
  | { kind: "error"; block: ErrorBlock }

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
    } else if (block.type === "error") {
      flushBubble()
      flushTools(false)
      groups.push({ kind: "error", block })
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

export function MessageBubble({
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
        if (group.kind === "error") {
          return <ErrorBubble key={gi} block={group.block} />
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

/* ── Error bubble ─────────────────────────────────────────────── */

function ErrorBubble({ block }: { block: ErrorBlock }) {
  const ctaUrl = billingCtaUrl(block)
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/10 px-5 py-4 space-y-3 text-destructive">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
            {block.message}
          </p>
        </div>
        {ctaUrl && (
          <button
            type="button"
            onClick={() => {
              void shellOpen(ctaUrl)
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive/90 underline-offset-4 hover:underline"
          >
            Open billing page
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}
