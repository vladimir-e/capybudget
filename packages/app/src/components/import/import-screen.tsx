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
} from "lucide-react";
import { toast } from "sonner";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join as joinPath } from "@tauri-apps/api/path";
import { Button } from "@/components/ui/button";
import { useImportSession } from "@/hooks/use-import-session";
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
import { ImportPreview } from "./import-preview";
import { Wrench } from "lucide-react";

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

  const resolveImportPath = useCallback(
    async (filename: string) => {
      const dir = await joinPath(budgetPath, ".capy/import");
      return joinPath(dir, filename);
    },
    [budgetPath],
  );

  const checkDisk = useCallback(async () => {
    try {
      const csvPath = await resolveImportPath("transactions.csv");
      const content = await readTextFile(csvPath);
      setHasImportData(content.trim().length > 0);
    } catch {
      setHasImportData(false);
    }
  }, [resolveImportPath, setHasImportData]);

  // Check disk on mount
  useEffect(() => {
    checkDisk();
  }, [checkDisk]);

  // ── Local UI state ──────────────────────────────────────────
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const customInstructions = useCustomInstructions(budgetPath);

  // ── Intelligence session ────────────────────────────────────
  const importSession = useImportSession({
    budgetPath,
    budgetName,
    mcpServerPath: "packages/mcp/src/server.ts",
    customInstructions: customInstructions.instructions,
    onNormalizationComplete: checkDisk,
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
    }
  }, []);

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
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Actions ─────────────────────────────────────────────────
  const handleStart = () => {
    if (files.length === 0 || isProcessing) return;
    importSession.startNormalization(files);
  };

  const handleCancel = useCallback(async () => {
    importSession.cancel();
    setFiles([]);
    // Wipe import files on disk
    await Promise.allSettled([
      resolveImportPath("state.json").then((p) => writeTextFile(p, "")),
      resolveImportPath("transactions.csv").then((p) => writeTextFile(p, "")),
    ]);
    setHasImportData(false);
  }, [importSession, resolveImportPath, setHasImportData]);

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
          {(showProcessing || showPreview) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-muted-foreground gap-1.5 shrink-0"
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
                    {files.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-xl bg-card/50 px-4 py-3 border border-border/30"
                      >
                        {isImageAttachment(file) ? (
                          <Image className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        ) : (
                          <FileIcon className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                        )}
                        <span className="flex-1 truncate text-sm text-foreground/80">
                          {file.name}
                        </span>
                        <span className="text-xs text-muted-foreground/50 tabular-nums">
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
                    ))}
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
                <div className="space-y-4">
                  {importSession.messages
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
                    Processing...
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Preview area ───────────────────────────────── */}
          {showPreview && <ImportPreview budgetPath={budgetPath} />}

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
