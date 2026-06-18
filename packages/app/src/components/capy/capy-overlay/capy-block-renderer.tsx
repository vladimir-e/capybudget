import { formatText } from "@/lib/format-text"
import { useFormatMoney } from "@/contexts/currency-context"
import type {
  BarChartBlock,
  ContentBlock,
  DonutChartBlock,
  TableBlock,
} from "@capybudget/intelligence"
import { FileChip } from "./file-chip"

export function BlockRenderer({
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
          {formatText(block.content)}
        </p>
      )
    case "table":
      return <TableView headers={block.headers} rows={block.rows} />
    case "bar-chart":
      return <BarChart title={block.title} data={block.data} />
    case "donut-chart":
      return <DonutChart title={block.title} data={block.data} />
    case "tool-activity":
      // Grouped into ToolGroupCard by groupBlocks() before reaching
      // BlockRenderer.
      return null
    case "file-attachment":
      return <FileChip name={block.name} size={block.size} mediaType={block.mediaType} />
    case "followups":
      // Lifted out of the bubble by groupBlocks() and rendered as a
      // separate FollowupChips group.
      return null
    case "error":
      // Lifted out of the bubble by groupBlocks() and rendered as a
      // distinct ErrorBubble.
      return null
  }
}

/* ── Table ─────────────────────────────────────────────────────── */

function TableView({ headers, rows }: Pick<TableBlock, "headers" | "rows">) {
  const { symbol, symbolPosition } = useFormatMoney()
  // Tables can carry more columns than the chat panel is wide. Let the table
  // grow to its content width (min-w-full keeps narrow tables filling the
  // panel) and scroll the container horizontally rather than squeezing or
  // wrapping cells into an unreadable mess.
  //
  // Amount cells are color-coded by sign. A leading symbol is the cleanest
  // anchor, but only when the symbol actually leads (`before`); a trailing or
  // absent symbol leaves the sign/digit at the front, so we detect by that
  // instead.
  const sign = (cell: string): "expense" | "income" | null => {
    if (symbol && symbolPosition === "before") {
      if (cell.startsWith(`-${symbol}`)) return "expense"
      if (cell.startsWith(symbol)) return "income"
      return null
    }
    if (/^-\d/.test(cell)) return "expense"
    if (/^\d/.test(cell)) return "income"
    return null
  }
  return (
    <div className="rounded-xl border border-border/30 overflow-x-auto capy-scroll">
      <table className="w-max min-w-full text-sm">
        <thead>
          <tr className="bg-muted/40">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/20">
              {row.map((cell, j) => {
                const s = sign(cell)
                return (
                  <td
                    key={j}
                    className={`px-4 py-2.5 text-foreground/80 whitespace-nowrap ${
                      s === "expense"
                        ? "text-amount-expense font-medium tabular-nums"
                        : s === "income"
                          ? "text-amount-income font-medium tabular-nums"
                          : ""
                    }`}
                  >
                    {cell}
                  </td>
                )
              })}
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
