/**
 * Replay a captured Claude CLI stream-json session through `CliTurn` —
 * the exact decoder ClaudeCliSession runs per send — and print the
 * blocks each send-cycle ends with, i.e. what the chat UI would show.
 *
 * Input: a .jsonl file with the raw stdout of the `claude` subprocess
 * (one stream-json event per line; multiple send-cycles per file are
 * fine — each `result` line closes a cycle).
 *
 * Usage:
 *   npx tsx scripts/replay-cli-stream.ts /tmp/capy-runA.jsonl
 */
import { readFileSync } from "node:fs"
import type { ContentBlock, StreamEvent } from "@capybudget/intelligence"
import { CliTurn } from "../packages/intelligence/src/adapters/claude-cli/cli-turn"

const capturePath = process.argv[2]
if (!capturePath) {
  console.error("Usage: npx tsx scripts/replay-cli-stream.ts <capture.jsonl>")
  process.exit(1)
}

function describeBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return `text          ${JSON.stringify(truncate(block.content))}`
    case "followups":
      return `followups     ${block.chips.map((c) => c.label).join(" | ")}`
    case "tool-activity":
      return `tool-activity ${block.tool} (${block.status})`
    case "table":
      return `table         ${block.headers.join(", ")} (${block.rows.length} rows)`
    case "bar-chart":
    case "donut-chart":
      return `${block.type.padEnd(13)} "${block.title}" (${block.data.length} points)`
    case "file-attachment":
      return `file          ${block.name}`
    case "error":
      return `error         ${truncate(block.message)}`
  }
}

function truncate(s: string, max = 100): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

let cycle = 1
let lastBlocks: ContentBlock[] = []
let toolResults: Array<{ tool: string; ok: boolean }> = []

function printCycle(closedBy: string): void {
  console.log(`\n== cycle ${cycle++} (closed by: ${closedBy}) ==`)
  for (const block of lastBlocks) console.log(`  ${describeBlock(block)}`)
  if (lastBlocks.length === 0) console.log("  (no content)")
  for (const r of toolResults) console.log(`  tool-result   ${r.tool} ok=${r.ok}`)
  lastBlocks = []
  toolResults = []
}

function record(event: StreamEvent): void {
  if (event.type === "content") lastBlocks = event.blocks
  else if (event.type === "tool-result") toolResults.push({ tool: event.tool, ok: event.ok })
  else printCycle(event.type === "error" ? `error: ${event.code ?? truncate(event.message)}` : event.type)
}

let turn = new CliTurn(record)
for (const line of readFileSync(capturePath, "utf8").split("\n")) {
  turn.feed(line)
  if (turn.isOver) turn = new CliTurn(record)
}

if (lastBlocks.length > 0 || toolResults.length > 0) printCycle("EOF — cycle never closed!")
