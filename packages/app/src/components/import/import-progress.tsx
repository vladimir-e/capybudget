import { useEffect, useRef } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ImportPhase, TerminalLogEntry } from "@capybudget/intelligence";
import { cn } from "@/lib/utils";
import {
  PROGRESS_SEGMENTS,
  meterView,
  segmentState,
  type SegmentState,
} from "./import-progress-utils";

interface ImportProgressProps {
  /** The orchestrator's current phase. */
  phase: ImportPhase;
  /** Whether a run is in flight (drives the active-segment animation). */
  running: boolean;
  /** Current-status line under the bar; empty hides it. */
  status: string;
  /** Accumulated terminal log, oldest first. */
  log: TerminalLogEntry[];
  /** Categorizing batch meter, or null before it ticks. */
  batchProgress: { done: number; total: number } | null;
}

/**
 * The import progress showcase: a persistent section bar (Reading → Normalizing
 * → History → Categorizing), a current-status line, and a terminal-style log.
 *
 * The first three segments are near-instant; the Categorizing segment doubles
 * as the batch meter — its fill tracks landed batches and it carries a live
 * "Categorizing X of N" count over the remaining rows. Completed segments fill
 * and check; the active one animates.
 */
export function ImportProgress({ phase, running, status, log, batchProgress }: ImportProgressProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-2">
        {PROGRESS_SEGMENTS.map((seg, i) => (
          <Segment
            key={seg.phase}
            label={seg.label}
            state={segmentState(i, phase)}
            running={running}
            meter={seg.phase === "categorizing" ? batchProgress : null}
          />
        ))}
      </div>

      {status && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand shrink-0" />}
          <span className="truncate">{status}</span>
        </div>
      )}

      {log.length > 0 && <LogPane log={log} />}
    </div>
  );
}

// ── Section-bar segment ──────────────────────────────────────────

function Segment({
  label,
  state,
  running,
  meter,
}: {
  label: string;
  state: SegmentState;
  running: boolean;
  meter: { done: number; total: number } | null;
}) {
  const { fillPct, complete, countLabel } = meterView(state, meter);
  const hasMeter = !!meter && meter.total > 0;

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {complete ? (
          <Check className="h-3.5 w-3.5 text-amount-income shrink-0" />
        ) : state === "active" && running ? (
          <Loader2 className="h-3 w-3 animate-spin text-brand shrink-0" />
        ) : (
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              state === "active" ? "bg-brand" : "bg-muted-foreground/30",
            )}
          />
        )}
        <span
          className={cn(
            "truncate text-xs font-medium",
            state === "pending" ? "text-muted-foreground/50" : "text-foreground/80",
          )}
        >
          {label}
        </span>
        {countLabel && (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {countLabel}
          </span>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            complete ? "bg-amount-income" : "bg-brand",
            // The active non-meter segments (Reading/Normalizing/History) are
            // near-instant, so a soft pulse reads better than a frozen full bar.
            state === "active" && !hasMeter && running && "animate-pulse",
          )}
          style={{ width: `${fillPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Terminal log pane ────────────────────────────────────────────

const LEVEL_CLASS: Record<TerminalLogEntry["level"], string> = {
  info: "text-foreground/70",
  warn: "text-amber-500",
  error: "text-destructive",
};

function LogPane({ log }: { log: TerminalLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view — the run record reads bottom-up like a tail.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <div
      ref={scrollRef}
      className="max-h-40 overflow-y-auto rounded-xl border border-border/40 bg-muted/30 p-3 font-mono text-xs leading-relaxed"
    >
      {log.map((entry, i) => (
        <div key={`${entry.ts}-${i}`} className="flex gap-2">
          <span className="shrink-0 tabular-nums text-muted-foreground/50">{formatTime(entry.ts)}</span>
          <span className={cn("min-w-0 break-words", LEVEL_CLASS[entry.level])}>{entry.message}</span>
        </div>
      ))}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
