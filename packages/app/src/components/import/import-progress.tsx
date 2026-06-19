import { useEffect, useRef } from "react";
import { Check, Loader2, Sparkles, Square } from "lucide-react";
import type {
  BatchProgress,
  ImportPhase,
  NormalizeProgress,
  TerminalLogEntry,
} from "@capybudget/intelligence";
import { useTranslation } from "@capybudget/i18n";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  PROGRESS_SEGMENTS,
  meterView,
  segmentState,
  type MeterCount,
  type SegmentMeter,
  type SegmentState,
} from "./import-progress-utils";

/** The localized "X of N" / "X rows" count for a metered segment. */
function countLabel(count: MeterCount, t: TFunction<["import", "common"]>): string | null {
  if (!count) return null;
  if (count.kind === "rows") return t("progress.countRows", { count: count.done });
  return t("progress.countOf", { done: count.done, total: count.total });
}

interface ImportProgressProps {
  /** The orchestrator's current phase. */
  phase: ImportPhase;
  /** Whether a run is in flight (drives the active-segment animation). */
  running: boolean;
  /** Current-status line under the bar; empty hides it. */
  status: string;
  /** Accumulated terminal log, oldest first. */
  log: TerminalLogEntry[];
  /** Normalizing row counter, or null before it ticks. */
  normalizeProgress: NormalizeProgress | null;
  /** Enhancing (categorizing) batch meter, or null before it ticks. */
  batchProgress: BatchProgress | null;
  /** Stop the in-flight run (keeps staging — resumable). */
  onStop: () => void;
  /** The idle-state enrichable remainder + its trigger; null (or a zero count)
   *  hides the Enrich control. */
  enrich: { count: number; run: () => void } | null;
}

/**
 * The import progress showcase: a persistent two-segment section bar
 * (Normalizing → Enhancing), a current-status line, and a terminal-style log.
 *
 * The Normalizing segment meters streamed extraction rows / CSV row counts;
 * the Enhancing segment doubles as the batch meter — its fill tracks landed
 * batches with a live "X of N" count over the remaining rows. Completed
 * segments fill and check; the active one animates. The run control lives on
 * the bar's right edge: Stop while in flight, "Enrich N" when idle rows still
 * need the classifier.
 */
export function ImportProgress({
  phase,
  running,
  status,
  log,
  normalizeProgress,
  batchProgress,
  onStop,
  enrich,
}: ImportProgressProps) {
  const { t } = useTranslation(["import", "common"]);
  const showEnrich = !running && !!enrich && enrich.count > 0;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-stretch gap-2 min-w-0">
          {PROGRESS_SEGMENTS.map((seg, i) => {
            const state = segmentState(i, phase);
            // The Normalizing meter only speaks for the live phase — once the
            // pipeline moves on, the segment is simply done (its totals were
            // estimates). The Enhancing meter stays attached even at `done` so
            // an interrupted run reads partly-filled, not falsely checked.
            const meter: SegmentMeter | null =
              seg.key === "normalizing"
                ? state === "active" && normalizeProgress
                  ? { done: normalizeProgress.rows, total: normalizeProgress.total }
                  : null
                : batchProgress;
            return (
              <Segment
                key={seg.key}
                label={t(`progress.${seg.key}`)}
                state={state}
                running={running}
                meter={meter}
                t={t}
              />
            );
          })}
        </div>
        {(running || showEnrich) && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={running ? onStop : enrich?.run}
          >
            {running ? (
              <>
                <Square className="h-3.5 w-3.5" />
                {t("progress.stop")}
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                {t("progress.enrich", { count: enrich?.count })}
              </>
            )}
          </Button>
        )}
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
  t,
}: {
  label: string;
  state: SegmentState;
  running: boolean;
  meter: SegmentMeter | null;
  t: TFunction<["import", "common"]>;
}) {
  const { fillPct, complete, count } = meterView(state, meter);
  const meterLabel = countLabel(count, t);
  const proportional = !!meter && meter.total !== null && meter.total > 0;

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
        {meterLabel && (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {meterLabel}
          </span>
        )}
      </div>

      <div
        className={cn(
          "h-1.5 overflow-hidden rounded-full bg-muted",
          // An active segment without a proportional meter renders full-width,
          // and one whose meter hasn't ticked yet renders empty (the wait on
          // the first model response) — a soft pulse reads better in both than
          // a frozen bar. It rides on the track so the empty case stays visible.
          state === "active" && (!proportional || fillPct === 0) && running && "animate-pulse",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            complete ? "bg-amount-income" : "bg-brand",
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
