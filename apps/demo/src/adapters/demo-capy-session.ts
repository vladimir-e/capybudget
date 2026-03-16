/**
 * Demo stub for the Tauri-based CapySession.
 *
 * Instead of spawning Claude CLI, it emits pre-built sample responses
 * that showcase the rich content rendering (tables, charts).
 */

import type { SessionEvent } from "@capybudget/intelligence";

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

  async send(_message: string): Promise<void> {
    this.alive = true;

    // Simulate streaming with small delays
    const emit = (line: string) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          this.onEvent({ type: "stdout", line });
          resolve();
        }, 100);
      });

    // Step 1: Tool activity
    await emit(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "mcp__capy__spending_summary", input: {} },
        ],
      },
    }));

    // Step 2: Text + table
    await emit(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "mcp__capy__spending_summary", input: {} },
          {
            type: "text",
            text: "Here's a sample of what Capy can do with your budget data. In the full desktop app, I analyze your actual transactions in real time.",
          },
          {
            type: "tool_use",
            name: "mcp__capy__render_table",
            input: {
              headers: ["Category", "January", "February", "Change"],
              rows: [
                ["Groceries", "$217.50", "$265.00", "+22%"],
                ["Dining Out", "$194.00", "$236.00", "+22%"],
                ["Housing", "$1,950.00", "$1,950.00", "—"],
                ["Subscriptions", "$26.98", "$26.98", "—"],
                ["Transportation", "$45.00", "$52.00", "+16%"],
              ],
            },
          },
        ],
      },
    }));

    // Step 3: Add bar chart
    await emit(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "mcp__capy__spending_summary", input: {} },
          {
            type: "text",
            text: "Here's a sample of what Capy can do with your budget data. In the full desktop app, I analyze your actual transactions in real time.",
          },
          {
            type: "tool_use",
            name: "mcp__capy__render_table",
            input: {
              headers: ["Category", "January", "February", "Change"],
              rows: [
                ["Groceries", "$217.50", "$265.00", "+22%"],
                ["Dining Out", "$194.00", "$236.00", "+22%"],
                ["Housing", "$1,950.00", "$1,950.00", "—"],
                ["Subscriptions", "$26.98", "$26.98", "—"],
                ["Transportation", "$45.00", "$52.00", "+16%"],
              ],
            },
          },
          {
            type: "tool_use",
            name: "mcp__capy__render_bar_chart",
            input: {
              title: "February Spending by Category",
              data: [
                { label: "Housing", value: 1950.0 },
                { label: "Groceries", value: 265.0 },
                { label: "Big Purchases", value: 350.0 },
                { label: "Dining Out", value: 236.0 },
                { label: "Bills & Utilities", value: 215.0 },
              ],
            },
          },
        ],
      },
    }));

    // Step 4: Add donut chart + closing text
    await emit(JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "mcp__capy__spending_summary", input: {} },
          {
            type: "text",
            text: "Here's a sample of what Capy can do with your budget data. In the full desktop app, I analyze your actual transactions in real time.",
          },
          {
            type: "tool_use",
            name: "mcp__capy__render_table",
            input: {
              headers: ["Category", "January", "February", "Change"],
              rows: [
                ["Groceries", "$217.50", "$265.00", "+22%"],
                ["Dining Out", "$194.00", "$236.00", "+22%"],
                ["Housing", "$1,950.00", "$1,950.00", "—"],
                ["Subscriptions", "$26.98", "$26.98", "—"],
                ["Transportation", "$45.00", "$52.00", "+16%"],
              ],
            },
          },
          {
            type: "tool_use",
            name: "mcp__capy__render_bar_chart",
            input: {
              title: "February Spending by Category",
              data: [
                { label: "Housing", value: 1950.0 },
                { label: "Groceries", value: 265.0 },
                { label: "Big Purchases", value: 350.0 },
                { label: "Dining Out", value: 236.0 },
                { label: "Bills & Utilities", value: 215.0 },
              ],
            },
          },
          {
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
          },
          {
            type: "text",
            text: "This is a demo — AI features require the Capy Budget desktop app with Claude CLI installed. Download it to get personalized insights, spending analysis, and natural-language budget management.",
          },
        ],
      },
    }));

    // Done
    await emit(JSON.stringify({ type: "result" }));
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
