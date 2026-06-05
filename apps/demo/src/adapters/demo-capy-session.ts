/**
 * Demo stub for the Tauri-based CapySession.
 *
 * Instead of spawning Claude CLI, it emits a pre-built sample chat response
 * with realistic streaming timing. Smart Import is desktop-only in the demo,
 * so chat is the only flow this stub serves.
 *
 * Wire shape: emits typed `StreamEvent`s directly — same contract the
 * real adapters use post-refactor. The demo never has a process to
 * die, so `onExit` is unused.
 */

import type {
  ContentBlock,
  MessageContent,
  StreamEvent,
} from "@capybudget/intelligence";

export interface CapySessionOptions {
  budgetPath: string;
  mcpServerPath: string;
  systemPrompt: string;
  onEvent: (event: StreamEvent) => void;
}

// ── Session class ───────────────────────────────────────────────────

export class CapySession {
  private readonly onEvent: (event: StreamEvent) => void;
  private alive = false;
  private cancelled = false;

  constructor(opts: CapySessionOptions) {
    this.onEvent = opts.onEvent;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  async send(_content: MessageContent): Promise<void> {
    this.alive = true;
    this.cancelled = false;
    await this.simulateChat();
  }

  /** Cumulative-blocks emitter. The real adapters emit
   *  `StreamEvent.content` with the complete blocks array on every tick;
   *  the demo accumulates locally and re-emits the full snapshot so
   *  consumers can replace the trailing assistant message's blocks
   *  wholesale (no deduplication needed). */
  private emit(blocks: ContentBlock[]): void {
    if (this.cancelled) return;
    this.onEvent({ type: "content", blocks: [...blocks] });
  }

  // ── Chat ─────────────────────────────────────────────────────────

  private async simulateChat(): Promise<void> {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const blocks: ContentBlock[] = [];

    blocks.push({ type: "tool-activity", tool: "list_transactions" });
    this.emit(blocks);
    await delay(2000);
    if (this.cancelled) return;

    blocks.push({
      type: "text",
      content:
        "Happy to help! I track your spending, categorize transactions, answer questions about your budget, and turn messy bank exports into a clean ledger. Here's a taste — your spending this month:",
    });
    this.emit(blocks);
    await delay(200);
    if (this.cancelled) return;

    blocks.push({
      type: "donut-chart",
      title: "This Month's Spending",
      data: [
        { label: "Housing", value: 1850.0 },
        { label: "Groceries", value: 612.0 },
        { label: "Dining Out", value: 284.0 },
        { label: "Transportation", value: 196.0 },
        { label: "Other", value: 433.0 },
      ],
    });
    this.emit(blocks);
    await delay(1000);
    if (this.cancelled) return;

    const closingText =
      "This is a demo, and Capy's intelligence layer is only available in the desktop app. Download the desktop app to chat with Capy about your real budget, get personalized insights, and use smart import.";
    const words = closingText.split(" ");
    let accumulated = "";
    const textBlockIndex = blocks.length;
    blocks.push({ type: "text", content: "" });
    for (let i = 0; i < words.length; i += 3) {
      if (this.cancelled) return;
      const chunk = words.slice(i, i + 3).join(" ");
      accumulated += (accumulated ? " " : "") + chunk;
      blocks[textBlockIndex] = { type: "text", content: accumulated };
      this.emit(blocks);
      await delay(100);
    }

    this.finish();
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  private finish(): void {
    if (this.cancelled) return;
    this.onEvent({ type: "done" });
    this.alive = false;
  }

  async stop(): Promise<void> {
    this.cancelled = true;
    this.alive = false;
  }

  async restart(): Promise<void> {
    this.cancelled = true;
    this.alive = false;
  }

  async kill(): Promise<void> {
    this.cancelled = true;
    this.alive = false;
  }
}
