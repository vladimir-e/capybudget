import { AlertTriangle, Check, Loader2, Wrench } from "lucide-react";
import { getToolLabel } from "@/lib/tool-labels";
import { useImportStore } from "@/stores/import-store";
import type { ChatMessage } from "@capybudget/intelligence";
import {
  PROGRESS_SEGMENTS,
  SEGMENT_LABELS,
  segmentStates,
} from "./import-progress";

/** Tool-activity tags pulled from the run's assistant blocks — secondary
 *  detail under the status line (which tools ran), never the primary channel.
 *  Consecutive repeats of the same tool collapse to one chip. */
function toolActivity(messages: ChatMessage[]): string[] {
  const tools = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.blocks)
    .filter((b) => b.type === "tool-activity")
    .map((b) => b.tool);
  return tools.filter((tool, i) => tool !== tools[i - 1]);
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The running import's presentation: a phase-driven progress bar, the latest
 * `report_status` line, and the timestamped log of prior lines. No assistant
 * prose — import mode talks via `report_status`. A run that errors mid-flight
 * renders the failure as a prominent result here (halt/completion land on the
 * preview instead).
 */
export function ProcessingStatus() {
  const phase = useImportStore((s) => s.phase);
  const statusText = useImportStore((s) => s.statusText);
  const statusLog = useImportStore((s) => s.statusLog);
  const runMessages = useImportStore((s) => s.runMessages);
  const runOutcome = useImportStore((s) => s.runOutcome);

  const states = segmentStates(phase);
  const tools = toolActivity(runMessages);
  const errored = runOutcome?.kind === "error";

  return (
    <div className="space-y-5">
      {/* Phase-driven progress bar */}
      <div className="flex items-stretch gap-1.5">
        {PROGRESS_SEGMENTS.map((segment) => {
          const state = states[segment];
          return (
            <div key={segment} className="flex-1 space-y-1.5">
              <div
                className={`h-1.5 rounded-full transition-colors ${
                  errored
                    ? "bg-border/40"
                    : state === "complete"
                      ? "bg-brand"
                      : state === "active"
                        ? "bg-brand/40 animate-pulse"
                        : "bg-border/40"
                }`}
              />
              <div
                className={`flex items-center gap-1 text-[11px] ${
                  state === "active" && !errored
                    ? "text-foreground font-medium"
                    : state === "complete" && !errored
                      ? "text-muted-foreground"
                      : "text-muted-foreground/40"
                }`}
              >
                {state === "complete" && !errored && (
                  <Check className="h-3 w-3 text-brand" />
                )}
                {SEGMENT_LABELS[segment]}
              </div>
            </div>
          );
        })}
      </div>

      {errored ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-foreground/80">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-foreground">Import failed</p>
            <p className="mt-0.5 text-muted-foreground">
              {runOutcome?.message ?? "Something went wrong."}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Current step */}
          <div className="flex items-center gap-2.5 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand shrink-0" />
            <span className="text-foreground/90">
              {statusText || "Summoning Capy…"}
            </span>
          </div>

          {/* Timestamped log of prior steps */}
          {statusLog.length > 0 && (
            <ol className="space-y-1.5 border-l border-border/40 pl-3">
              {statusLog.map((entry, i) => (
                <li
                  key={`${entry.at}-${i}`}
                  className="flex items-baseline gap-2 text-xs text-muted-foreground/70"
                >
                  <span className="tabular-nums text-muted-foreground/40">
                    {formatTime(entry.at)}
                  </span>
                  <span>{entry.text}</span>
                </li>
              ))}
            </ol>
          )}

          {/* Tool activity — secondary detail */}
          {tools.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tools.map((tool, i) => (
                <span
                  key={`${tool}-${i}`}
                  className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground/60"
                >
                  <Wrench className="h-2.5 w-2.5" />
                  {getToolLabel(tool)}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
