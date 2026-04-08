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
  Copy,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useImportRepository, type SourceFileInfo } from "@/hooks/use-import-repository";
import { useImportStore } from "@/stores/import-store";
import { useImportInstructions } from "@/hooks/use-custom-instructions";
import { useAccounts } from "@/hooks/use-budget-data";
import { getToolLabel } from "@/services/capy-stream";
import {
  formatFileSize,
  IMPORT_SYSTEM_PROMPT,
  type ContentBlock,
} from "@capybudget/intelligence";
import { formatDateLabel } from "@capybudget/core";
import { AccountSelector } from "@/components/budget/account-selector";
import { ImportPreview } from "./import-preview";

// ── Helpers ─────────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  ".csv", ".tsv", ".json", ".xml", ".md", ".txt", ".log", ".ofx", ".qfx", ".qif",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
]);

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (file.type === "application/json" || file.type === "application/xml") return true;
  if (file.type === "application/pdf") return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function isImageFilename(name: string): boolean {
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// ── Component ───────────────────────────────────────────────────

interface ImportScreenProps {
  budgetPath: string;
  budgetName: string;
}

/** View state for the import screen. */
type ImportViewState =
  | "loading"        // checking disk on mount
  | "empty"          // no files → drop zone
  | "has-sources"    // source files ready → file list + Start
  | "normalizing"    // AI processing
  | "has-preview";   // transactions.csv ready → preview

export function ImportScreen({ budgetPath, budgetName }: ImportScreenProps) {
  // ── Store state (survives navigation) ─────────────────────────
  const phase = useImportStore((s) => s.phase);
  const normalizeMessages = useImportStore((s) => s.normalizeMessages);
  const startNormalization = useImportStore((s) => s.startNormalization);
  const cancelNormalization = useImportStore((s) => s.cancelNormalization);
  const setPhase = useImportStore((s) => s.setPhase);
  const setGlobalHasImportData = useImportStore((s) => s.setHasImportData);

  // ── Local UI state ────────────────────────────────────────────
  const [diskChecked, setDiskChecked] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<SourceFileInfo[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());

  const repository = useImportRepository(budgetPath);

  const [fileDuplicates, setFileDuplicates] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const customInstructions = useImportInstructions(budgetPath);
  const [localInstructions, setLocalInstructions] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const { data: accounts = [] } = useAccounts();

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

  // On mount: if store is idle, check disk to determine initial state.
  // If store is "normalizing" or "preview", trust the store (reconnect).
  useEffect(() => {
    async function init() {
      if (phase === "idle") {
        const hasCsv = await repository.hasTransactionsCsv();
        if (hasCsv) {
          setPhase("preview");
          setGlobalHasImportData(true);
        } else {
          await refreshSourceFiles();
          setGlobalHasImportData(false);
        }
      } else if (phase === "normalizing") {
        // Reconnecting — load source files for the processing header
        await refreshSourceFiles();
      }
      setDiskChecked(true);
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run once on mount

  // Auto-scroll processing messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [normalizeMessages]);

  // ── Derived view state ────────────────────────────────────────
  // Store phase is the authority. Disk state only matters for idle sub-states.
  let viewState: ImportViewState;
  if (!diskChecked && phase === "idle") {
    viewState = "loading";
  } else if (phase === "normalizing") {
    viewState = "normalizing";
  } else if (phase === "preview") {
    viewState = "has-preview";
  } else if (sourceFiles.length > 0) {
    viewState = "has-sources";
  } else {
    viewState = "empty";
  }

  // ── File handling (write to disk immediately) ─────────────────

  const processFiles = useCallback(async (rawFiles: File[]) => {
    for (const file of rawFiles) {
      const isImage = isImageFile(file);
      if (!isImage && !isTextFile(file)) {
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
    if (sourceFiles.length === 0 || phase === "normalizing") return;
    console.log("[import] starting normalization with", sourceFiles.length, "source files");

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

    startNormalization({
      budgetPath,
      budgetName,
      mcpServerPath: "packages/mcp/src/server.ts",
      systemPrompt,
      sourceFilenames: sourceFiles.map((f) => f.name),
    });
  };

  const handleCancel = useCallback(async () => {
    console.log("[import] cancelling import");
    cancelNormalization();
    setFileDuplicates({});
    await repository.clearImportData();
    setSourceFiles([]);
  }, [cancelNormalization, repository]);

  // ── Render ────────────────────────────────────────────────────
  const showProcessing = viewState === "normalizing";
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
                    : sourceFiles.length > 0
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

              {(sourceFiles.length > 0 || uploadingFiles.size > 0) && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    {sourceFiles.length} file{sourceFiles.length !== 1 ? "s" : ""} ready
                    {uploadingFiles.size > 0 && (
                      <span className="ml-2 text-brand">
                        ({uploadingFiles.size} uploading...)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {[...uploadingFiles].map((name) => (
                      <div
                        key={`uploading-${name}`}
                        className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-card/50 border-border/30 opacity-60"
                      >
                        <Upload className="h-4 w-4 text-brand animate-pulse shrink-0" />
                        <span className="truncate block text-sm text-foreground/80 flex-1">
                          {name}
                        </span>
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand shrink-0" />
                      </div>
                    ))}
                    {sourceFiles.map((file) => {
                      const dupDate = fileDuplicates[file.name];
                      return (
                        <div
                          key={file.name}
                          className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${
                            dupDate
                              ? "bg-amber-500/5 border-amber-500/20"
                              : "bg-card/50 border-border/30"
                          }`}
                        >
                          {isImageFilename(file.name) ? (
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
                            onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
                            className="rounded-lg p-1 text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <textarea
                    value={localInstructions ?? ""}
                    onChange={(e) => setLocalInstructions(e.target.value)}
                    onBlur={() => customInstructions.save((localInstructions ?? "").trim())}
                    placeholder="e.g. &quot;This is my Excel budget export, amounts are in the Debit/Credit columns&quot;"
                    rows={2}
                    className="w-full resize-none rounded-xl border border-border/30 bg-card/30 px-4 py-3 text-sm text-foreground/80 placeholder:text-muted-foreground/40 focus:border-brand/40 focus:outline-none focus:ring-1 focus:ring-brand/20"
                  />
                  <div className="flex items-center justify-between pt-1">
                    <AccountSelector
                      accounts={accounts}
                      value={selectedAccountId}
                      onChange={setSelectedAccountId}
                      placeholder="Any account"
                      clearable
                    />
                    <Button
                      onClick={handleStart}
                      disabled={uploadingFiles.size > 0}
                      className="gap-2 rounded-xl px-6 py-5 text-base font-semibold shadow-lg shadow-brand/20"
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
                <ProcessingStatus messages={normalizeMessages} />
              </div>
            </>
          )}

          {/* ── Preview area ───────────────────────────────── */}
          {showPreview && (
            <ImportPreview
              budgetPath={budgetPath}
              budgetName={budgetName}
              onMergeComplete={() => { setPhase("idle"); setGlobalHasImportData(false); setSourceFiles([]); }}
            />
          )}

        </div>
      </div>

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
