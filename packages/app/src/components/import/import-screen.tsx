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
  Sparkles,
  X,
  File as FileIcon,
  Image,
  Loader2,
  Wrench,
  Settings,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useImportSession } from "@/hooks/use-import-session";
import { useImportRepository } from "@/hooks/use-import-repository";
import { useImportStore } from "@/stores/import-store";
import { useCustomInstructions } from "@/hooks/use-custom-instructions";
import { getToolLabel } from "@/services/capy-stream";
import {
  MAX_ATTACHMENT_SIZE,
  MAX_TOTAL_ATTACHMENT_SIZE,
  formatFileSize,
  isImageAttachment,
  type FileAttachment,
  type ContentBlock,
} from "@capybudget/intelligence";
import { formatDateLabel } from "@capybudget/core";
import { InstructionsDialog } from "@/components/capy/instructions-dialog";
import { ImportPreview } from "./import-preview";

// ── Helpers ─────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".csv", ".tsv", ".json", ".xml", ".md", ".txt", ".log", ".ofx", ".qfx", ".qif",
]);

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") return true;
  if (file.type === "application/pdf") return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ───────────────────────────────────────────────────

interface ImportScreenProps {
  budgetPath: string;
  budgetName: string;
}

export function ImportScreen({ budgetPath, budgetName }: ImportScreenProps) {
  // ── Disk state (source of truth) ────────────────────────────
  const [hasImportData, setLocalHasImportData] = useState<boolean | null>(null);
  const setGlobalHasImportData = useImportStore((s) => s.setHasImportData);

  const setHasImportData = useCallback(
    (v: boolean) => {
      setLocalHasImportData(v);
      setGlobalHasImportData(v);
    },
    [setGlobalHasImportData],
  );

  const repository = useImportRepository(budgetPath);

  const checkDisk = useCallback(async () => {
    const has = await repository.hasImportData();
    setHasImportData(has);
  }, [repository, setHasImportData]);

  // Check disk on mount
  useEffect(() => {
    async function init() {
      await checkDisk();
    }
    init();
  }, [checkDisk]);

  // ── Local UI state ──────────────────────────────────────────
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [fileDuplicates, setFileDuplicates] = useState<Record<string, string>>({}); // filename → import date
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const customInstructions = useCustomInstructions(budgetPath);
  const [showInstructions, setShowInstructions] = useState(false);

  // ── Intelligence session ────────────────────────────────────
  const importSession = useImportSession({
    budgetPath,
    budgetName,
    mcpServerPath: "packages/mcp/src/server.ts",
    customInstructions: customInstructions.instructions,
    onImportComplete: checkDisk,
  });

  const isProcessing = importSession.isStreaming;

  // Auto-scroll processing messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [importSession.messages]);

  // ── File handling ───────────────────────────────────────────
  const processFiles = useCallback(async (rawFiles: File[]) => {
    const candidates: FileAttachment[] = [];
    for (const file of rawFiles) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`${file.name} exceeds 5MB limit`);
        continue;
      }
      const isImage = file.type.startsWith("image/");
      if (!isImage && !isTextFile(file)) {
        toast.error(`${file.name} is not a supported file type`);
        continue;
      }
      const content = isImage ? await readFileAsBase64(file) : await file.text();
      candidates.push({
        name: file.name,
        content,
        size: file.size,
        mediaType: file.type || "text/plain",
      });
    }
    if (candidates.length > 0) {
      setFiles((prev) => {
        let runningTotal = prev.reduce((s, a) => s + a.size, 0);
        const accepted: FileAttachment[] = [];
        for (const c of candidates) {
          if (runningTotal + c.size > MAX_TOTAL_ATTACHMENT_SIZE) {
            toast.error("Total attachment size exceeds 10MB");
            break;
          }
          accepted.push(c);
          runningTotal += c.size;
        }
        return accepted.length > 0 ? [...prev, ...accepted] : prev;
      });

      // Check file names against import log (last 20 entries)
      try {
        const log = await repository.readImportLog();
        const recent = log.slice(-20);
        const dupes: Record<string, string> = {};
        for (const file of candidates) {
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
    }
  }, [repository]);

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

  const removeFile = (index: number) => {
    const removed = files[index];
    setFiles((prev) => prev.filter((_, i) => i !== index));
    if (removed && fileDuplicates[removed.name]) {
      setFileDuplicates((prev) => {
        const next = { ...prev };
        delete next[removed.name];
        return next;
      });
    }
  };

  // ── Actions ─────────────────────────────────────────────────
  const handleStart = async () => {
    if (files.length === 0 || isProcessing) return;
    console.log("[import] starting normalization with", files.length, "files");

    // Persist source file names so the merge step can log them
    try {
      await repository.writeState({ sourceFiles: files.map((f) => f.name) });
    } catch {
      /* best-effort */
    }

    importSession.startNormalization(files);
  };

  const handleCancel = useCallback(async () => {
    console.log("[import] cancelling import");
    importSession.cancel();
    setFiles([]);
    setFileDuplicates({});
    await repository.clearImportData();
    setHasImportData(false);
  }, [importSession, repository, setHasImportData]);

  // ── Derived view ────────────────────────────────────────────
  // no files  → drop zone + Start
  // processing → processing output
  // has files  → preview area
  const showProcessing = isProcessing;
  const showPreview = !isProcessing && hasImportData === true;
  const showDropZone = !isProcessing && !hasImportData;

  const subtitle = showProcessing
    ? "Processing your files..."
    : showPreview
      ? "Review and edit imported transactions"
      : "Drop files to import transactions";

  // Loading state (initial disk check)
  if (hasImportData === null) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowInstructions(true)}
            className="gap-1.5 shrink-0"
          >
            <Settings className="h-3.5 w-3.5" />
            Capy Instructions
          </Button>
          {(showProcessing || showPreview) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
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

          {/* ── Drop zone ──────────────────────────────────── */}
          {showDropZone && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`group relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 ${
                  isDragging
                    ? "border-brand bg-brand/5 scale-[1.01]"
                    : files.length > 0
                      ? "border-border/50 bg-card/30 hover:border-brand/30 hover:bg-brand/3"
                      : "border-border/40 bg-card/20 hover:border-brand/30 hover:bg-brand/3"
                }`}
              >
                <div className="flex flex-col items-center justify-center px-6 py-16">
                  <div
                    className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl transition-colors ${
                      isDragging
                        ? "bg-brand/15 text-brand"
                        : "bg-muted/40 text-muted-foreground group-hover:bg-brand/10 group-hover:text-brand"
                    }`}
                  >
                    <FileUp className="h-7 w-7" />
                  </div>
                  <p className="text-base font-medium text-foreground/80">
                    {isDragging ? "Drop files here" : "Drop files or click to browse"}
                  </p>
                  <p className="mt-1.5 text-sm text-muted-foreground/60">
                    CSV, PDF, images of bank statements
                  </p>
                </div>
              </div>

              {files.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    {files.length} file{files.length !== 1 ? "s" : ""} ready
                  </div>
                  <div className="space-y-1.5">
                    {files.map((file, i) => {
                      const dupDate = fileDuplicates[file.name];
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                            dupDate
                              ? "bg-amber-500/5 border-amber-500/20"
                              : "bg-card/50 border-border/30"
                          }`}
                        >
                          {isImageAttachment(file) ? (
                            <Image className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                          ) : (
                            <FileIcon className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <span className="truncate block text-sm text-foreground/80">
                              {file.name}
                            </span>
                            {dupDate && (
                              <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                                <Copy className="h-3 w-3 shrink-0" />
                                might be a duplicate — imported on {formatDateLabel(dupDate.slice(0, 10))}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">
                            {formatFileSize(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                            className="rounded-lg p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-center pt-2">
                    <Button
                      onClick={handleStart}
                      className="gap-2 rounded-xl px-8 py-5 text-base font-semibold shadow-lg shadow-brand/20"
                    >
                      <Sparkles className="h-4.5 w-4.5" />
                      Start Import
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Processing output ──────────────────────────── */}
          {showProcessing && (
            <>
              <div className="flex flex-wrap gap-2">
                {files.map((file, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1 text-xs text-foreground/70"
                  >
                    {isImageAttachment(file) ? (
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
                <ProcessingStatus messages={importSession.messages} />
              </div>
            </>
          )}

          {/* ── Preview area ───────────────────────────────── */}
          {showPreview && (
            <ImportPreview
              budgetPath={budgetPath}
              budgetName={budgetName}
              onMergeComplete={() => { setFiles([]); setHasImportData(false); }}
            />
          )}

        </div>
      </div>

      <InstructionsDialog
        open={showInstructions}
        onOpenChange={setShowInstructions}
        instructions={customInstructions.instructions}
        onSave={customInstructions.save}
      />
    </div>
  );
}

/* ── Block Renderer ──────────────────────────────────────────────── */

function NormalizationBlock({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return (
        <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
          {block.content}
        </p>
      );
    case "tool-activity":
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
          <Wrench className="h-3 w-3" />
          <span>{getToolLabel(block.tool)}</span>
        </div>
      );
    case "file-attachment":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1 text-xs text-foreground/70">
          <FileIcon className="h-3 w-3 text-muted-foreground" />
          {block.name}
          <span className="text-muted-foreground/50">{formatFileSize(block.size)}</span>
        </span>
      );
    default:
      return null;
  }
}

/* ── Processing Status ───────────────────────────────────────────── */

function ProcessingStatus({ messages }: { messages: import("@capybudget/intelligence").ChatMessage[] }) {
  const assistantBlocks = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.blocks);

  const hasContent = assistantBlocks.length > 0;
  const hasToolActivity = assistantBlocks.some((b) => b.type === "tool-activity");

  // Derive status label from what's happened so far
  let statusLabel = "Summoning Capy...";
  if (hasContent && !hasToolActivity) statusLabel = "Analyzing files...";
  if (hasToolActivity) statusLabel = "Writing results...";

  return (
    <div className="space-y-4">
      {messages
        .filter((m) => m.role === "assistant")
        .map((msg) => (
          <div key={msg.id} className="space-y-3">
            {msg.blocks.map((block, i) => (
              <NormalizationBlock key={i} block={block} />
            ))}
          </div>
        ))}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
        {statusLabel}
      </div>
    </div>
  );
}
