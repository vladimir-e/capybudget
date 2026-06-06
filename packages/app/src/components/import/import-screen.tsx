import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from "react";
import {
  FileUp,
  X,
  File as FileIcon,
  Image,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
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
import { useImportStore } from "@/stores/import-store";
import { useImportInstructions } from "@/hooks/use-custom-instructions";
import { useAccounts, useBudgetSnapshot } from "@/hooks/use-budget-data";
import { useIntelligenceStore } from "@/stores/intelligence-store";
import { useBudgetRepository } from "@/contexts/repository-context";
import {
  bytesToBase64,
  imageMimeForFilename,
  isImageFile,
  isImageFilename,
  isImportTextFile,
  isPdfFilename,
} from "@/lib/file-attachments";
import { tauriFileAdapter } from "../../../../../src/adapters/tauri-file-adapter";
import {
  buildContext,
  formatFileSize,
  readImportEnriched,
  IMPORT_SYSTEM_PROMPT,
  IMPORT_RESUME_SYSTEM_PROMPT,
  type CliImageContent,
  type CliDocumentContent,
  type MessageContent,
} from "@capybudget/intelligence";
import { ImportDropZone } from "./import-drop-zone";
import { ProcessingStatus } from "./processing-status";
import { ImportPreview } from "./import-preview";
import { resolveReconnect } from "./import-reconnect";

interface ImportScreenProps {
  budgetPath: string;
  budgetName: string;
}

/** View state for the import screen. */
type ImportViewState =
  | "loading"        // checking disk on mount
  | "empty"          // no files → drop zone
  | "has-sources"    // source files ready → file list + Start
  | "processing"     // the orchestrated run (normalize → … → enrich)
  | "has-preview";   // run complete → merge-ready review

export function ImportScreen({ budgetPath, budgetName }: ImportScreenProps) {
  // ── Store state (survives navigation) ─────────────────────────
  const phase = useImportStore((s) => s.phase);
  const startRun = useImportStore((s) => s.startRun);
  const cancelRun = useImportStore((s) => s.cancelRun);
  const resumeRun = useImportStore((s) => s.resumeRun);
  const restoreReviewOutcome = useImportStore((s) => s.restoreReviewOutcome);
  const resetAfterMerge = useImportStore((s) => s.resetAfterMerge);
  const setPhase = useImportStore((s) => s.setPhase);
  const setGlobalHasImportData = useImportStore((s) => s.setHasImportData);

  // ── Local UI state ────────────────────────────────────────────
  const [diskChecked, setDiskChecked] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<SourceFileInfo[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());

  const repository = useImportRepository(budgetPath);
  const repo = useBudgetRepository();

  const [fileDuplicates, setFileDuplicates] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const customInstructions = useImportInstructions(budgetPath);
  const [localInstructions, setLocalInstructions] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const { data: accounts = [] } = useAccounts();
  const getBudgetSnapshot = useBudgetSnapshot();

  // Import only requires a configured AI provider — provider-specific
  // capability gaps (e.g. OpenAI's chat API not accepting PDF bytes)
  // are encapsulated in each adapter. The OpenAI adapter drops PDF
  // blocks and substitutes an explanatory text note so the model can
  // still respond coherently.
  const navigate = useNavigate();
  const provider = useIntelligenceStore((s) => s.config.provider);
  const importSupported = provider !== null;

  // Seed local instructions from persisted value once loaded
  useEffect(() => {
    if (localInstructions === null && !customInstructions.isLoading) {
      setLocalInstructions(customInstructions.instructions ?? "");
    }
  }, [customInstructions.isLoading, customInstructions.instructions, localInstructions]);

  /** Refresh source file list from disk. */
  const refreshSourceFiles = useCallback(async () => {
    const sources = await repository.listSourceFiles();
    setSourceFiles(sources);
    return sources;
  }, [repository]);

  /**
   * Resume an interrupted run: re-run the full post-normalize pipeline
   * (accounts → … → enrich) over the staging CSV in a fresh session. The
   * dropped source files are gone, so normalize is not re-run — the staging
   * rows are the input, read through the import tools.
   */
  const resumeFullRun = useCallback(() => {
    const customInstr = customInstructions.instructions?.trim();
    const systemPrompt = customInstr
      ? `${IMPORT_RESUME_SYSTEM_PROMPT}\n\n## User instructions\n${customInstr}`
      : IMPORT_RESUME_SYSTEM_PROMPT;
    resumeRun({
      budgetPath,
      mcpServerPath: "packages/mcp/src/server.ts",
      systemPrompt,
      repo,
      fileAdapter: tauriFileAdapter,
    });
  }, [customInstructions.instructions, resumeRun, budgetPath, repo]);

  // On mount: if store is idle, check disk to determine initial state.
  // If a run is in flight (normalizing → … → enriching) or done (review),
  // trust the store (reconnect).
  useEffect(() => {
    async function init() {
      if (phase === "idle") {
        const hasCsv = await repository.hasTransactionsCsv();
        const enriched = hasCsv && (await readImportEnriched(tauriFileAdapter, budgetPath));
        const action = resolveReconnect(hasCsv, enriched);
        if (action.kind === "empty") {
          await refreshSourceFiles();
          setGlobalHasImportData(false);
        } else if (action.kind === "review") {
          setPhase("review");
          setGlobalHasImportData(true);
          // A reconnect into review lost the in-memory run outcome — re-derive
          // it from staging so the completion banner / "nothing to import"
          // result survive (best-effort; null on failure falls back to table).
          void restoreReviewOutcome({ budgetPath, fileAdapter: tauriFileAdapter });
        } else {
          // Interrupted run — re-run the full post-normalize pipeline. The
          // screen stays on the processing view (resumeFullRun drives the
          // phase machine) until the run lands on review.
          setGlobalHasImportData(true);
          resumeFullRun();
        }
      } else if (phase !== "review") {
        // Reconnecting mid-run — load source files for the processing header
        await refreshSourceFiles();
      }
      setDiskChecked(true);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // Keep the active status line + newest log entry in view. They sit at the
  // top of the panel (newest-first), so anchor to the top as each line lands.
  const statusText = useImportStore((s) => s.statusText);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [statusText, phase]);

  // ── Derived view state ────────────────────────────────────────
  // Store phase is the authority. Disk state only matters for idle sub-states.
  // Every run phase (normalize → … → enrich) renders the processing stream on
  // this screen; only the terminal `review` swaps to the preview table.
  let viewState: ImportViewState;
  if (!diskChecked && phase === "idle") {
    viewState = "loading";
  } else if (phase === "review") {
    viewState = "has-preview";
  } else if (phase !== "idle") {
    viewState = "processing";
  } else if (sourceFiles.length > 0) {
    viewState = "has-sources";
  } else {
    viewState = "empty";
  }

  // ── File handling (write to disk immediately) ─────────────────

  const processFiles = useCallback(async (rawFiles: File[]) => {
    for (const file of rawFiles) {
      const isImage = isImageFile(file);
      if (!isImage && !isImportTextFile(file)) {
        toast.error(`${file.name} is not a supported file type`);
        continue;
      }

      setUploadingFiles((prev) => new Set(prev).add(file.name));

      try {
        if (isImage) {
          const buffer = await file.arrayBuffer();
          await repository.writeSourceFile(file.name, new Uint8Array(buffer));
        } else {
          const text = await file.text();
          await repository.writeSourceFile(file.name, text);
        }
      } catch (err) {
        toast.error(`Failed to save ${file.name}`);
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
      const log = await repository.readImportLog();
      const recent = log.slice(-20);
      const dupes: Record<string, string> = {};
      for (const file of rawFiles) {
        for (let i = recent.length - 1; i >= 0; i--) {
          if (recent[i].sourceFiles?.includes(file.name)) {
            dupes[file.name] = recent[i].date;
            break;
          }
        }
      }
      if (Object.keys(dupes).length > 0) {
        setFileDuplicates((prev) => ({ ...prev, ...dupes }));
      }
    } catch {
      /* best-effort */
    }
  }, [repository, refreshSourceFiles]);

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

  const removeFile = useCallback(async (filename: string) => {
    await repository.removeSourceFile(filename);
    setFileDuplicates((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    await refreshSourceFiles();
  }, [repository, refreshSourceFiles]);

  // ── Actions ───────────────────────────────────────────────────
  const handleStart = async () => {
    if (sourceFiles.length === 0 || (phase !== "idle" && phase !== "review")) return;
    console.debug("[import] starting run with", sourceFiles.length, "source files");

    try {
      await repository.writeState({ sourceFiles: sourceFiles.map((f) => f.name) });
    } catch {
      /* best-effort */
    }

    const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
    const parts: string[] = [];
    if (selectedAccount) parts.push(`Account: ${selectedAccount.name}`);
    const customInstr = (localInstructions ?? "").trim();
    if (customInstr) parts.push(customInstr);

    const systemPrompt = parts.length > 0
      ? `${IMPORT_SYSTEM_PROMPT}\n\n## User instructions\n${parts.join("\n")}`
      : IMPORT_SYSTEM_PROMPT;

    // Build the initial multimodal message. Text files get listed by
    // name (the agent reads them via analyze_csv / read_file); image
    // and PDF bytes ride in the message itself. PDFs ship as `document`
    // blocks uniformly; the OpenAI adapter substitutes an explanatory
    // text note since chat.completions can't ingest PDFs.
    const textFiles = sourceFiles.filter((f) => !isImageFilename(f.name) && !isPdfFilename(f.name));
    const imageFiles = sourceFiles.filter((f) => isImageFilename(f.name));
    const pdfFiles = sourceFiles.filter((f) => isPdfFilename(f.name));

    const attachments: Array<CliImageContent | CliDocumentContent> = [];
    for (const f of imageFiles) {
      const bytes = await repository.readSourceFileBytes(f.name);
      attachments.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imageMimeForFilename(f.name),
          data: bytesToBase64(bytes),
        },
      });
    }
    for (const f of pdfFiles) {
      const bytes = await repository.readSourceFileBytes(f.name);
      attachments.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: bytesToBase64(bytes),
        },
      });
    }

    const context = buildContext({ budgetName, budgetPath, snapshot: getBudgetSnapshot() });
    const textInstructions = (() => {
      const lines: string[] = [context, ""];
      lines.push(
        "Normalize the following source files for import. Files with names listed below are in .capy/import/sources/; image and PDF bytes are attached to this message.",
      );
      lines.push("");
      if (textFiles.length > 0) {
        lines.push("Text source files (use analyze_csv / read_file):");
        for (const f of textFiles) lines.push(`- ${f.name}`);
        lines.push("");
      }
      if (imageFiles.length > 0 || pdfFiles.length > 0) {
        lines.push("Attached for visual extraction (read directly from this message):");
        for (const f of imageFiles) lines.push(`- ${f.name}`);
        for (const f of pdfFiles) lines.push(`- ${f.name}`);
        lines.push("");
      }
      lines.push(
        "For CSV / text sources, follow the analyze → preview → transform pipeline. For images / PDFs, extract transactions from the attached content and write them via write_import_file (mode 'append' to add to existing rows).",
      );
      return lines.join("\n");
    })();

    const initialMessage: MessageContent =
      attachments.length > 0
        ? [{ type: "text", text: textInstructions }, ...attachments]
        : textInstructions;

    startRun({
      budgetPath,
      mcpServerPath: "packages/mcp/src/server.ts",
      systemPrompt,
      initialMessage,
      sourceFilenames: sourceFiles.map((f) => f.name),
      repo,
      fileAdapter: tauriFileAdapter,
    });
  };

  const handleCancel = useCallback(async () => {
    console.debug("[import] cancelling import");
    cancelRun();
    setFileDuplicates({});
    await repository.clearImportData();
    setSourceFiles([]);
  }, [cancelRun, repository]);

  // ── Render ────────────────────────────────────────────────────
  const showProcessing = viewState === "processing";
  const showPreview = viewState === "has-preview";
  const showDropZone = viewState === "empty" || viewState === "has-sources";

  const subtitle = showProcessing
    ? "Processing your files..."
    : showPreview
      ? "Review and edit imported transactions"
      : "Drop files to import transactions";

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
      {/* Overlay frame deliberately mirrors the seed box's dashed treatment
          so it reads as one frame expanding, not two stacked. */}
      {showDropZone && isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/60">
          <div className="absolute inset-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand/50 bg-brand/5 text-brand animate-in fade-in zoom-in-95 duration-150">
            <FileUp className="h-10 w-10" />
            <p className="text-lg font-semibold">Drop files to import</p>
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
            <h2 className="text-xl font-bold tracking-tight">Import</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {(showProcessing || showPreview) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelConfirm(true)}
              className="gap-1.5 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              Cancel Import
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className={`mx-auto space-y-6 ${showPreview ? "max-w-6xl" : "max-w-2xl"}`}>

          {showDropZone && (
            <ImportDropZone
              importSupported={importSupported}
              onOpenSettings={() => navigate({ to: "/budget/settings", search: { path: budgetPath, name: budgetName } })}
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
            />
          )}

          {/* ── Processing output ──────────────────────────── */}
          {showProcessing && (
            <>
              <div className="flex flex-wrap gap-2">
                {sourceFiles.map((file) => (
                  <span
                    key={file.name}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1 text-xs text-foreground/70"
                  >
                    {isImageFilename(file.name) ? (
                      <Image className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <FileIcon className="h-3 w-3 text-muted-foreground" />
                    )}
                    {file.name}
                    <span className="text-muted-foreground/50">{formatFileSize(file.size)}</span>
                  </span>
                ))}
              </div>
              <div
                ref={scrollRef}
                className="rounded-2xl border border-border/30 bg-card/30 p-5 max-h-[60vh] overflow-y-auto"
              >
                <ProcessingStatus />
              </div>
            </>
          )}

          {/* ── Preview area ───────────────────────────────── */}
          {showPreview && (
            <ImportPreview
              budgetPath={budgetPath}
              budgetName={budgetName}
              onMergeComplete={() => { resetAfterMerge(); setSourceFiles([]); }}
            />
          )}

        </div>
      </div>

      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel import?</DialogTitle>
            <DialogDescription>
              This discards the uploaded files and any transactions Capy has
              extracted. It can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
              Keep importing
            </Button>
            <Button
              variant="destructive"
              onClick={() => { setShowCancelConfirm(false); handleCancel(); }}
            >
              Discard import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
