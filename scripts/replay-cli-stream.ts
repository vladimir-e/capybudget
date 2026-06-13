/**
 * Replay a captured Claude CLI stream-json session through the real
 * parser (`parseStreamLine`) and accumulator (`CycleAccumulator`) —
 * the exact code path ClaudeCliSession runs in the app — and print the
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
import type { ContentBlock } from "@capybudget/intelligence"
import { CycleAccumulator } from "../packages/app/src/services/claude-cli-accumulator"
import { parseStreamLine, type CycleState } from "../packages/app/src/services/claude-cli-stream"

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
      return `tool-activity ${block.tool}`
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

const registry = new Map<string, string>()
const cycleState: CycleState = { doneEmitted: false }
const accumulator = new CycleAccumulator()

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

for (const line of readFileSync(capturePath, "utf8").split("\n")) {
  for (const event of parseStreamLine(line, registry, cycleState)) {
    const out = accumulator.accumulate(event)
    if (out.type === "content") lastBlocks = out.blocks
    if (out.type === "tool-result") toolResults.push({ tool: out.tool, ok: out.ok })
    if (out.type === "done" || out.type === "error") {
      printCycle(out.type)
      registry.clear()
      cycleState.doneEmitted = false // simulate the next send() arming the cycle
    }
  }
}

if (lastBlocks.length > 0 || toolResults.length > 0) printCycle("EOF — cycle never closed!")
