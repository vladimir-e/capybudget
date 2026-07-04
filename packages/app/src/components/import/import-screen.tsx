import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from "react";
import { FileUp, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@capybudget/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useImportRepository, type SourceFileInfo } from "@/hooks/use-import-repository";
import type { ImportPhase } from "@capybudget/intelligence";
import { useImportStore } from "@/stores/import-store";
import { useImportOrchestrator } from "@/hooks/use-import-orchestrator";
import { useImportInstructions } from "@/hooks/use-custom-instructions";
import { useAccounts } from "@/hooks/use-budget-data";
import {
  isImageFile,
  isImportBinaryFile,
  isImportTextFile,
  isPdfFilename,
  readFileAsBase64,
} from "@/lib/file-attachments";
import { ImportDropZone } from "./import-drop-zone";
import { ImportProgress } from "./import-progress";
import { resumeMeter } from "./import-progress-utils";
import { ImportPreview } from "./import-preview";

interface ImportScreenProps {
  budgetPath: string;
  budgetName: string;
}

/** What the screen is showing right now — a pure function of disk staging + the
 *  live run state, never a separate stored phase. */
type ImportViewState =
  | "loading"      // checking disk on mount
  | "file-attach"  // no staging + no run → drop zone
  | "run";         // a run is in flight or staging exists → progress + preview

export function ImportScreen({ budgetPath, budgetName }: ImportScreenProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(["import", "common"]);
  const repository = useImportRepository(budgetPath);

  // ── Orchestrator + run state ──────────────────────────────────
  const { canStart, pdfSupported, provider, start, enrich, stop, cancel, staging } = useImportOrchestrator(budgetPath);
  const phase = useImportStore((s) => s.phase);
  const status = useImportStore((s) => s.status);
  const log = useImportStore((s) => s.log);
  const normalizeProgress = useImportStore((s) => s.normalizeProgress);
  const batchProgress = useImportStore((s) => s.batchProgress);
  const grounded = useImportStore((s) => s.grounded);
  const error = useImportStore((s) => s.error);
  const running = useImportStore((s) => s.running);
  const rowsVersion = useImportStore((s) => s.rowsVersion);
  const reset = useImportStore((s) => s.reset);
  const setHasImportData = useImportStore((s) => s.setHasImportData);

  // ── Local UI state ────────────────────────────────────────────
  const [diskChecked, setDiskChecked] = useState(false);
  const [hasStaging, setHasStaging] = useState(false);
  // Categorizing meter reconstructed from disk on a resume — keeps the section
  // bar honest before any live `batchProgress` exists. Cleared once a run starts.
  const [resumeBatch, setResumeBatch] = useState<{ done: number; total: number } | null>(null);
  const [sourceFiles, setSourceFiles] = useState<SourceFileInfo[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [fileDuplicates, setFileDuplicates] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // The preview's live enrichable count + flush-then-enrich trigger, surfaced
  // up so the progress section's control can render it.
  const [enrichControl, setEnrichControl] = useState<{ count: number; run: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const customInstructions = useImportInstructions(budgetPath);
  const [localInstructions, setLocalInstructions] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const { data: accounts = [] } = useAccounts();

  // Seed local instructions from persisted value once loaded.
  useEffect(() => {
    if (localInstructions === null && !customInstructions.isLoading) {
      setLocalInstructions(customInstructions.instructions ?? "");
    }
  }, [customInstructions.isLoading, customInstructions.instructions, localInstructions]);

  const refreshSourceFiles = useCallback(async () => {
    const sources = await repository.listSourceFiles();
    setSourceFiles(sources);
    return sources;
  }, [repository]);

  // Where we land is a pure function of staging:
  //  - transactions.csv exists → preview (resume, with whatever enrichment landed).
  //    Even when read-validation dropped every staged row, the preview is where
  //    the skip surfaces and the Cancel control discards — falling through to
  //    file-attach would strand the staging (the chat on-ramp refuses while
  //    transactions.csv exists).
  //  - no transactions.csv but state.json says a chat staged the sources → this is
  //    a Capy-initiated run; auto-run the orchestrator (the second on-ramp). A
  //    manual drop never writes state.json, so it falls through to file-attach and
  //    waits for the user to press Start.
  // This runs on mount and again each time Capy stages a chat import (the user may
  // already be on this tab, where navigation alone wouldn't remount the screen).
  const mountedRef = useRef(true);
  const checkStaging = useCallback(async (): Promise<void> => {
    try {
      const [staged, transferCtx] = await Promise.all([
        staging.readTransactions(),
        staging.readTransferContext().then((c) => c ?? {}),
      ]);
      if (!mountedRef.current) return;
      if (staged) {
        setHasStaging(true);
        setHasImportData(true);
        setResumeBatch(resumeMeter(staged.rows, new Set(Object.keys(transferCtx))));
        setDiskChecked(true);
        return;
      }
      const state = await staging.readState();
      if (!mountedRef.current) return;
      // A run already in flight owns the staging — don't re-fire over it. The
      // store's `running` flag survives navigation, so it's the authority here.
      const runInFlight = useImportStore.getState().running;
      if (state?.source === "chat" && !runInFlight) {
        setHasImportData(true);
        setDiskChecked(true);
        // Drop the chat marker before the run progresses, so a re-check in the
        // pre-History window doesn't spawn a second orchestrator over the same
        // sources. The orchestrator overwrites state.json as it advances anyway.
        await staging.writeState({ ...state, source: undefined });
        if (!mountedRef.current) return;
        // `start()` runs the plain staged sources — the chat on-ramp carries no
        // per-run account/instruction hints (those are file-attach controls).
        if (!start()) toast.error(t("errors.providerRequired"));
        return;
      }
      await refreshSourceFiles();
      if (!mountedRef.current) return;
      setHasImportData(false);
      setDiskChecked(true);
    } catch (err) {
      // Staging reads can be denied (e.g. MAS sandbox before the folder grant).
      // `diskChecked` gates the whole screen — always settle it, or the user is
      // stranded on the spinner.
      console.error("[import] staging check failed:", err);
      if (!mountedRef.current) return;
      setHasImportData(false);
      setDiskChecked(true);
    }
  }, [staging, start, refreshSourceFiles, setHasImportData, t]);

  useEffect(() => {
    mountedRef.current = true;
    void checkStaging();
    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // Re-check when Capy stages a chat import. Skips the initial value so it
  // doesn't double-run alongside the mount effect.
  const chatImportSignal = useImportStore((s) => s.chatImportSignal);
  const prevChatSignalRef = useRef(chatImportSignal);
  useEffect(() => {
    if (prevChatSignalRef.current === chatImportSignal) return;
    prevChatSignalRef.current = chatImportSignal;
    void checkStaging();
  }, [chatImportSignal, checkStaging]);

  // A run's first staging write (after History) flips us into preview; mirror
  // the orchestrator's progress into the sidebar "has data" dot.
  useEffect(() => {
    if (rowsVersion > 0) {
      setHasStaging(true);
      setHasImportData(true);
    }
  }, [rowsVersion, setHasImportData]);

  // Surface every run error with a toast — silent failures are the worst
  // outcome here. A recoverable one (`no_data`: a selfie, a non-financial doc)
  // wrote no staging and cleared sources, so return cleanly to file-attach.
  // A non-recoverable one before any staging (a Reading/Normalizing failure)
  // also has nothing to show — drop back to file-attach so the user can retry;
  // if rows did land, the preview stays put with the partial result.
  const reportedErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      reportedErrorRef.current = null;
      return;
    }
    const key = `${error.reason}:${error.message}`;
    if (reportedErrorRef.current === key) return;
    reportedErrorRef.current = key;

    toast.error(error.message);
    if (error.recoverable || !hasStaging) {
      reset();
      setHasStaging(false);
      setHasImportData(false);
      void refreshSourceFiles();
    }
  }, [error, hasStaging, reset, refreshSourceFiles, setHasImportData]);

  // ── Derived view state ────────────────────────────────────────
  let viewState: ImportViewState;
  if (!diskChecked) {
    viewState = "loading";
  } else if (running || hasStaging) {
    viewState = "run";
  } else {
    viewState = "file-attach";
  }

  // ── File handling (write to disk immediately) ─────────────────
  const processFiles = useCallback(
    async (rawFiles: File[]) => {
      for (const file of rawFiles) {
        const isImage = isImageFile(file);
        if (!isImage && !isImportTextFile(file)) {
          toast.error(t("errors.unsupportedType", { name: file.name }));
          continue;
        }
        // The active provider must be able to read PDFs, or the import starts a
        // run the model never sees.
        if ((file.type === "application/pdf" || isPdfFilename(file.name)) && !pdfSupported) {
          toast.error(t("errors.pdfNeedsCapableProvider", { name: file.name }));
          continue;
        }
        setUploadingFiles((prev) => new Set(prev).add(file.name));
        try {
          // Binary sources (images, PDFs) stage as base64 text — the staging
          // store reads `content` back as text and hands it to the model as
          // base64, so writing raw bytes here corrupts the round-trip. This
          // matches the chat on-ramp, which stages attachments base64-as-text.
          const content = isImportBinaryFile(file)
            ? await readFileAsBase64(file)
            : await file.text();
          await repository.writeSourceFile(file.name, content);
        } catch (err) {
          toast.error(t("errors.saveFailed", { name: file.name }));
          console.error("[import] write source file failed:", err);
        } finally {
          setUploadingFiles((prev) => {
            const next = new Set(prev);
            next.delete(file.name);
            return next;
          });
        }
      }
      await refreshSourceFiles();

      try {
        const recent = (await repository.readImportLog()).slice(-20);
        const dupes: Record<string, string> = {};
        for (const file of rawFiles) {
          for (let i = recent.length - 1; i >= 0; i--) {
            if (recent[i].sourceFiles?.includes(file.name)) {
              dupes[file.name] = recent[i].date;
              break;
            }
          }
        }
        if (Object.keys(dupes).length > 0) setFileDuplicates((prev) => ({ ...prev, ...dupes }));
      } catch {
        /* best-effort */
      }
    },
    [repository, refreshSourceFiles, pdfSupported, t],
  );

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      await processFiles(Array.from(e.dataTransfer.files));
    },
    [processFiles],
  );

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    await processFiles(selected);
  };

  const removeFile = useCallback(
    async (filename: string) => {
      await repository.removeSourceFile(filename);
      setFileDuplicates((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      await refreshSourceFiles();
    },
    [repository, refreshSourceFiles],
  );

  // ── Actions ───────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    if (sourceFiles.length === 0 || running) return;
    const instructions = (localInstructions ?? "").trim();
    await customInstructions.save(instructions);
    const accountName = accounts.find((a) => a.id === selectedAccountId)?.name;
    if (!start({ accountName, instructions })) {
      toast.error(t("errors.providerRequired"));
    }
  }, [
    sourceFiles,
    running,
    customInstructions,
    localInstructions,
    accounts,
    selectedAccountId,
    start,
    t,
  ]);

  const handleEnrich = useCallback(() => {
    const instructions = customInstructions.instructions?.trim();
    if (!enrich({ instructions })) {
      toast.error(t("errors.providerRequired"));
      return;
    }
    // A live run now owns the meter — drop the disk-reconstructed resume seed.
    setResumeBatch(null);
  }, [enrich, customInstructions.instructions, t]);

  const handleCancel = useCallback(async () => {
    // Cancel discards. Await the in-flight batch first — otherwise an
    // already-dispatched Categorizing batch lands after `clearImportData`,
    // re-creating staging and re-flipping the view into preview. `cancel()`
    // detaches the orchestrator (so its trailing events are dropped) and
    // resolves once nothing is in flight; only then is it safe to clear.
    await cancel();
    await repository.clearImportData();
    reset();
    setFileDuplicates({});
    setSourceFiles([]);
    setHasStaging(false);
    setResumeBatch(null);
    setHasImportData(false);
  }, [cancel, reset, repository, setHasImportData]);

  const handleMergeComplete = useCallback(() => {
    reset();
    setHasStaging(false);
    setResumeBatch(null);
    setHasImportData(false);
    setSourceFiles([]);
  }, [reset, setHasImportData]);

  // ── Render ────────────────────────────────────────────────────
  // AI config never gates file-attach; the gate is the CTA at the run boundary
  // inside the drop zone.
  const showDropZone = viewState === "file-attach";
  const showRun = viewState === "run";
  // The section bar persists through a run and stays as a done-from-state header
  // above a resumed or finished preview — staged rows mean Reading/Normalizing/
  // History all completed, so a resting `idle` phase renders as `done`. It only
  // disappears at file-attach. (`grounded` keeps the bar up for the brief window
  // between History's stats and the first staged-rows flip.)
  const barPhase: ImportPhase = phase === "idle" && hasStaging ? "done" : phase;
  const showProgressBar = showRun && (running || barPhase !== "idle" || grounded);

  const subtitle = running
    ? t("subtitle.importing")
    : showRun
      ? t("subtitle.review")
      : t("subtitle.drop");

  if (viewState === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={showDropZone ? handleDragEnter : undefined}
      onDragLeave={showDropZone ? handleDragLeave : undefined}
      onDragOver={showDropZone ? handleDragOver : undefined}
      onDrop={showDropZone ? handleDrop : undefined}
    >
      {showDropZone && isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/60">
          <div className="absolute inset-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand/50 bg-brand/5 text-brand animate-in fade-in zoom-in-95 duration-150">
            <FileUp className="h-10 w-10" />
            <p className="text-lg font-semibold">{t("dropOverlay")}</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b bg-gradient-to-b from-brand-subtle/40 to-transparent px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <FileUp className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">{t("title")}</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {showRun && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelConfirm(true)}
              className="gap-1.5 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              {t("cancelImport")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className={`mx-auto space-y-6 ${showRun ? "max-w-6xl" : "max-w-2xl"}`}>
          {showDropZone && (
            <ImportDropZone
              fileInputRef={fileInputRef}
              onFileSelect={handleFileSelect}
              dragging={isDragging}
              onBrowse={() => fileInputRef.current?.click()}
              sourceFiles={sourceFiles}
              uploadingFiles={uploadingFiles}
              fileDuplicates={fileDuplicates}
              onRemoveFile={removeFile}
              localInstructions={localInstructions}
              onInstructionsChange={setLocalInstructions}
              onInstructionsBlur={() => customInstructions.save((localInstructions ?? "").trim())}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              onAccountChange={setSelectedAccountId}
              onStart={handleStart}
              canStart={canStart}
              providerIsClaudeCli={provider === "claude-cli"}
              onSetupAi={() =>
                navigate({ to: "/budget/settings", search: { path: budgetPath, name: budgetName, section: "intelligence" } })
              }
            />
          )}

          {showRun && (
            <>
              {showProgressBar && (
                <ImportProgress
                  phase={barPhase}
                  running={running}
                  status={status}
                  log={log}
                  normalizeProgress={normalizeProgress}
                  batchProgress={batchProgress ?? resumeBatch}
                  onStop={() => void stop()}
                  enrich={enrichControl}
                />
              )}
              {hasStaging && (
                <ImportPreview
                  budgetPath={budgetPath}
                  staging={staging}
                  rowsVersion={rowsVersion}
                  running={running}
                  onStopRun={cancel}
                  onEnrich={handleEnrich}
                  onEnrichControl={setEnrichControl}
                  onMergeComplete={handleMergeComplete}
                />
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("cancelDialog.title")}</DialogTitle>
            <DialogDescription>{t("cancelDialog.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
              {t("cancelDialog.keep")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowCancelConfirm(false);
                void handleCancel();
              }}
            >
              {t("cancelDialog.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
