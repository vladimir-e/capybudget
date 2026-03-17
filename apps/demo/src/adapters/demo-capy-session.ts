/**
 * Demo stub for the Tauri-based CapySession.
 *
 * Instead of spawning Claude CLI, it emits pre-built sample responses
 * that showcase the rich content rendering (donut chart).
 * Simulates realistic streaming timing.
 */

import type { SessionEvent, MessageContent } from "@capybudget/intelligence";

export type { SessionEvent };

export interface CapySessionOptions {
  budgetPath: string;
  mcpServerPath: string;
  systemPrompt: string;
  onEvent: (event: SessionEvent) => void;
}

export class CapySession {
  private readonly onEvent: (event: SessionEvent) => void;
  private alive = false;

  constructor(opts: CapySessionOptions) {
    this.onEvent = opts.onEvent;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  async send(_content: MessageContent): Promise<void> {
    this.alive = true;

    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const emit = (content: unknown[]) =>
      this.onEvent({
        type: "stdout",
        line: JSON.stringify({ type: "assistant", message: { content } }),
      });

    // Step 1: Tool activity — "Calculating spending" spinner
    emit([{ type: "tool_use", name: "mcp__capy__spending_summary", input: {} }]);
    await delay(2000);

    // Step 2: Intro text
    emit([{
      type: "text",
      text: "Here's a sample of what Capy can do with your budget data. In the full desktop app, I analyze your actual transactions in real time.",
    }]);
    await delay(200);

    // Step 3: Donut chart
    emit([{
      type: "tool_use",
      name: "mcp__capy__render_donut_chart",
      input: {
        title: "Spending Distribution",
        data: [
          { label: "Housing", value: 1950.0 },
          { label: "Groceries", value: 265.0 },
          { label: "Big Purchases", value: 350.0 },
          { label: "Dining Out", value: 236.0 },
          { label: "Other", value: 538.0 },
        ],
      },
    }]);
    await delay(1000);

    // Step 4: Closing text — streamed in chunks
    const closingText =
      "This is a demo — AI features require the Capy Budget desktop app with Claude CLI installed. Download it to get personalized insights, spending analysis, and natural-language budget management.";
    const words = closingText.split(" ");
    let accumulated = "";
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(" ");
      accumulated += (accumulated ? " " : "") + chunk;
      emit([{ type: "text", text: accumulated }]);
      await delay(100);
    }

    // Done
    this.onEvent({
      type: "stdout",
      line: JSON.stringify({ type: "result" }),
    });
    this.alive = false;
  }

  async stop(): Promise<void> {
    this.alive = false;
  }

  async restart(): Promise<void> {
    this.alive = false;
  }

  async kill(): Promise<void> {
    this.alive = false;
  }
}
