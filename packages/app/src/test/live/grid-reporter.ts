import type { Reporter, TestCase, TestModule } from "vitest/node"

interface Cell {
  target: string
  scenario: string
  state: "pass" | "FAIL" | "skip" | "-"
  detail?: string
  seconds?: number
}

export default class GridReporter implements Reporter {
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const cells = modules.flatMap((m) => [...m.children.allTests()].map(toCell))
    if (cells.length === 0) return
    const targets = unique(cells.map((c) => c.target))
    const scenarios = unique(cells.map((c) => c.scenario))
    const lookup = new Map(cells.map((c) => [`${c.target}\u0000${c.scenario}`, c]))

    const header = ["scenario", ...targets]
    const rows = scenarios.map((scenario) => [
      scenario,
      ...targets.map((target) => {
        const cell = lookup.get(`${target}\u0000${scenario}`)
        if (!cell) return "-"
        return cell.seconds === undefined ? cell.state : `${cell.state} ${cell.seconds.toFixed(0)}s`
      }),
    ])
    const widths = header.map((_, i) => Math.max(...[header, ...rows].map((r) => r[i].length)))
    const line = (r: string[]) => r.map((v, i) => v.padEnd(widths[i])).join("  ")

    const out = ["", "Live smoke grid", line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)]

    const failures = cells.filter((c) => c.state === "FAIL")
    if (failures.length > 0) {
      out.push("", "Failures:")
      for (const c of failures) out.push(`  ${c.target} / ${c.scenario}: ${c.detail}`)
    }
    const skipReasons = unique(cells.filter((c) => c.state === "skip" && c.detail).map((c) => `  ${c.target}: ${c.detail}`))
    if (skipReasons.length > 0) out.push("", "Skipped:", ...skipReasons)

    console.log(out.join("\n") + "\n")
  }
}

function toCell(test: TestCase): Cell {
  const target = test.parent.type === "suite" ? test.parent.name : test.module.moduleId
  const result = test.result()
  const seconds = test.diagnostic()?.duration
  const base = { target, scenario: test.name }
  switch (result.state) {
    case "passed":
      return { ...base, state: "pass", seconds: seconds === undefined ? undefined : seconds / 1000 }
    case "failed":
      return {
        ...base,
        state: "FAIL",
        detail: firstLine(result.errors?.[0]?.message ?? "failed"),
        seconds: seconds === undefined ? undefined : seconds / 1000,
      }
    case "skipped":
      return { ...base, state: "skip", detail: result.note }
    default:
      return { ...base, state: "-" }
  }
}

function firstLine(message: string): string {
  const line = message.split("\n").find((l) => l.trim() !== "") ?? message
  return line.length > 300 ? `${line.slice(0, 297)}...` : line
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
