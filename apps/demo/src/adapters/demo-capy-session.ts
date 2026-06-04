/**
 * Demo stub for the Tauri-based CapySession.
 *
 * Instead of spawning Claude CLI, it emits pre-built sample responses.
 * Detects import/enrich/chat modes from the system prompt and simulates
 * each flow with realistic streaming timing.
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
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface CapySessionOptions {
  budgetPath: string;
  mcpServerPath: string;
  systemPrompt: string;
  onEvent: (event: StreamEvent) => void;
}

type SessionMode = "chat" | "import" | "enrich";

function detectMode(systemPrompt: string): SessionMode {
  if (systemPrompt.includes("normalize") || systemPrompt.includes("Normalize"))
    return "import";
  if (systemPrompt.includes("enrich") || systemPrompt.includes("Enrich"))
    return "enrich";
  return "chat";
}

// ── Sample import data ──────────────────────────────────────────────

const SAMPLE_TRANSACTIONS = [
  { id: "imp-1", date: "2026-01-27", description: "Mediterranean Grill (Midtown) - Combo Plate", amount: -1565, type: "expense", sourceAccount: "VISA 6999", sourceCategory: "", memo: "", merchant: "Mediterranean Grill", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-2", date: "2026-01-28", description: "Minero - Taco Combo w/ Steak & Crisps", amount: -1757, type: "expense", sourceAccount: "Credit Card", sourceCategory: "", memo: "", merchant: "Minero", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-3", date: "2026-01-29", description: "The Local - 10 Wings, Fries Basket, Tot...", amount: -3147, type: "expense", sourceAccount: "CC 6999", sourceCategory: "", memo: "", merchant: "The Local", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-4", date: "2026-02-01", description: "Whole Foods Market #10234 - Groceries", amount: -8523, type: "expense", sourceAccount: "VISA 6999", sourceCategory: "", memo: "", merchant: "Whole Foods Market", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-5", date: "2026-02-03", description: "Shell Gas Station #4412", amount: -4200, type: "expense", sourceAccount: "Credit Card", sourceCategory: "", memo: "", merchant: "Shell", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-6", date: "2026-02-05", description: "Netflix Monthly Subscription", amount: -1599, type: "expense", sourceAccount: "CC 6999", sourceCategory: "", memo: "", merchant: "Netflix", accountId: "", categoryId: "", categoryConfidence: "" },
  { id: "imp-7", date: "2026-02-07", description: "Employer Direct Deposit - Payroll", amount: 285000, type: "income", sourceAccount: "VISA 6999", sourceCategory: "", memo: "", merchant: "Employer Payroll", accountId: "", categoryId: "", categoryConfidence: "" },
];

function buildCsv(rows: typeof SAMPLE_TRANSACTIONS): string {
  const headers = "id,date,description,amount,type,sourceAccount,sourceCategory,memo,merchant,accountId,categoryId,categoryConfidence";
  const lines = rows.map((r) =>
    [r.id, r.date, `"${r.description}"`, r.amount, r.type, r.sourceAccount, r.sourceCategory, r.memo, r.merchant, r.accountId, r.categoryId, r.categoryConfidence].join(","),
  );
  return headers + "\r\n" + lines.join("\r\n");
}

// ── Session class ───────────────────────────────────────────────────

export class CapySession {
  private readonly opts: CapySessionOptions;
  private readonly onEvent: (event: StreamEvent) => void;
  private alive = false;
  private cancelled = false;

  constructor(opts: CapySessionOptions) {
    this.opts = opts;
    this.onEvent = opts.onEvent;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  async send(content: MessageContent): Promise<void> {
    this.alive = true;
    this.cancelled = false;

    const mode = detectMode(this.opts.systemPrompt);

    switch (mode) {
      case "import":
        await this.simulateImport(content);
        break;
      case "enrich":
        await this.simulateEnrich();
        break;
      default:
        await this.simulateChat();
    }
  }

  /** Cumulative-blocks emitter shared by all simulators. The real
   *  adapters emit `StreamEvent.content` with the complete blocks
   *  array on every tick; the demo accumulates locally and re-emits
   *  the full snapshot so consumers can replace the trailing
   *  assistant message's blocks wholesale (no deduplication needed). */
  private emit(blocks: ContentBlock[]): void {
    if (this.cancelled) return;
    this.onEvent({ type: "content", blocks: [...blocks] });
  }

  // ── Import normalization ────────────────────────────────────────

  private async simulateImport(_content: MessageContent): Promise<void> {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const blocks: ContentBlock[] = [];

    // Step 1: Reading files (Claude CLI's built-in Read tool)
    blocks.push({ type: "tool-activity", tool: "Read" });
    this.emit(blocks);
    await delay(1500);
    if (this.cancelled) return;

    // Step 2: Analysis text — streamed word-by-word, cumulative.
    const analysisText =
      "Let me read these and extract the transactions! Here's what I found:\n\n" +
      "1. **Mediterranean Grill** - Jan 27, 2026 - $15.65, VISA ending 6999\n" +
      "2. **Minero** - Jan 28, 2026 - $17.57, Credit card\n" +
      "3. **The Local** - Jan 29, 2026 - $31.47, CC ending 6999\n" +
      "4. **Whole Foods Market** - Feb 1, 2026 - $85.23, VISA ending 6999\n" +
      "5. **Shell Gas Station** - Feb 3, 2026 - $42.00, Credit card\n" +
      "6. **Netflix** - Feb 5, 2026 - $15.99, CC ending 6999\n" +
      "7. **Employer Payroll** - Feb 7, 2026 - $2,850.00 (income), VISA ending 6999";

    const words = analysisText.split(" ");
    let accumulated = "";
    const textBlockIndex = blocks.length;
    blocks.push({ type: "text", content: "" });
    for (let i = 0; i < words.length; i += 4) {
      if (this.cancelled) return;
      const chunk = words.slice(i, i + 4).join(" ");
      accumulated += (accumulated ? " " : "") + chunk;
      blocks[textBlockIndex] = { type: "text", content: accumulated };
      this.emit(blocks);
      await delay(80);
    }
    await delay(500);
    if (this.cancelled) return;

    // Step 3: Write CSV to in-memory FS
    accumulated += "\n\nLet me write the normalized CSV!";
    blocks[textBlockIndex] = { type: "text", content: accumulated };
    this.emit(blocks);
    await delay(300);
    if (this.cancelled) return;

    blocks.push({ type: "tool-activity", tool: "write_import_file" });
    this.emit(blocks);
    await delay(800);
    if (this.cancelled) return;

    const bp = this.opts.budgetPath;
    const csvPath = `${bp}/.capy/import/transactions.csv`;
    const statePath = `${bp}/.capy/import/state.json`;
    await writeTextFile(csvPath, buildCsv(SAMPLE_TRANSACTIONS));

    // Merge with existing state (ImportScreen already wrote sourceFiles)
    let existingState: Record<string, unknown> = {};
    try { existingState = JSON.parse(await readTextFile(statePath)); } catch { /* first write */ }
    await writeTextFile(statePath, JSON.stringify({ ...existingState, enriched: false }));

    this.finish();
  }

  // ── Enrichment ──────────────────────────────────────────────────

  private async simulateEnrich(): Promise<void> {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const blocks: ContentBlock[] = [];

    blocks.push({ type: "tool-activity", tool: "Read" });
    this.emit(blocks);
    await delay(1000);
    if (this.cancelled) return;

    blocks.push({ type: "text", content: "Identifying merchants and assigning categories..." });
    this.emit(blocks);
    await delay(1500);
    if (this.cancelled) return;

    // Enrichment is a no-op in demo (categories stay empty).
    // markEnriched() in onEnrichmentComplete handles state.json update.
    blocks.push({ type: "tool-activity", tool: "write_import_file" });
    this.emit(blocks);
    await delay(600);
    if (this.cancelled) return;

    this.finish();
  }

  // ── Chat (default / existing behavior) ──────────────────────────

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
        "Here's a sample of what Capy can do with your budget data. In the full desktop app, I analyze your actual transactions in real time.",
    });
    this.emit(blocks);
    await delay(200);
    if (this.cancelled) return;

    blocks.push({
      type: "donut-chart",
      title: "Spending Distribution",
      data: [
        { label: "Housing", value: 1950.0 },
        { label: "Groceries", value: 265.0 },
        { label: "Big Purchases", value: 350.0 },
        { label: "Dining Out", value: 236.0 },
        { label: "Other", value: 538.0 },
      ],
    });
    this.emit(blocks);
    await delay(1000);
    if (this.cancelled) return;

    const closingText =
      "This is a demo — AI features require the Capy Budget desktop app. Download it to get personalized insights, spending analysis, and natural-language budget management.";
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
