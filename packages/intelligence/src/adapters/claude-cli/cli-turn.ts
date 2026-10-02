import { TurnDisplay, toolCallBlock } from "../agent-turn"
import type { StreamEvent } from "../../types"
import { parseStreamLine, type CliEvent, type CliPart } from "./stream-parser"

export class CliTurn {
  private readonly display: TurnDisplay
  private readonly calls = new Map<string, string>()
  private messageId: string | undefined
  private openText: string | null = null
  private followupsShown = false
  private ended = false

  constructor(private readonly emit: (event: StreamEvent) => void) {
    this.display = new TurnDisplay((blocks) => emit({ type: "content", blocks }))
  }

  get isOver(): boolean {
    return this.ended
  }

  feed(line: string): void {
    for (const event of parseStreamLine(line)) {
      if (this.ended) return
      this.apply(event)
    }
  }

  private apply(event: CliEvent): void {
    switch (event.type) {
      case "message":
        if (event.id !== undefined && event.id !== this.messageId) {
          this.messageId = event.id
          this.closeText()
        }
        for (const part of event.parts) this.show(part)
        return
      case "tool-result": {
        const tool = this.calls.get(event.id)
        if (tool === undefined) return
        this.display.markFinished(event.id, event.ok)
        this.emit({ type: "tool-result", tool, id: event.id, ok: event.ok })
        return
      }
      case "end":
        this.ended = true
        this.display.settle()
        this.emit(event.event)
        return
    }
  }

  private show(part: CliPart): void {
    if (part.type === "text") {
      if (this.followupsShown) return
      if (this.openText !== null && part.text.startsWith(this.openText)) {
        this.display.appendText(part.text.slice(this.openText.length))
      } else {
        this.display.endText()
        this.display.appendText(part.text)
      }
      this.openText = part.text
      return
    }
    const block = toolCallBlock(part.name, part.input)
    this.calls.set(part.id, part.name)
    this.closeText()
    this.display.addCall(part.id, block)
    this.display.markStarted(part.id)
    if (block.type === "followups") this.followupsShown = true
  }

  private closeText(): void {
    this.display.endText()
    this.openText = null
  }
}
