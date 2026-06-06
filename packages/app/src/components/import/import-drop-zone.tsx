import { type ChangeEvent, type RefObject } from "react";
import {
  Copy,
  File as FileIcon,
  FileUp,
  Image,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountSelector } from "@/components/budget/account-selector";
import { type SourceFileInfo } from "@/hooks/use-import-repository";
import { isImageFilename } from "@/lib/file-attachments";
import { formatFileSize } from "@capybudget/intelligence";
import { formatDateLabel, type Account } from "@capybudget/core";

interface ImportDropZoneProps {
  importSupported: boolean;
  onOpenSettings: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  dragging: boolean;
  onBrowse: () => void;
  sourceFiles: SourceFileInfo[];
  uploadingFiles: Set<string>;
  fileDuplicates: Record<string, string>;
  onRemoveFile: (filename: string) => void;
  localInstructions: string | null;
  onInstructionsChange: (value: string) => void;
  onInstructionsBlur: () => void;
  accounts: Account[];
  selectedAccountId: string;
  onAccountChange: (id: string) => void;
  onStart: () => void;
}

export function ImportDropZone({
  importSupported,
  onOpenSettings,
  fileInputRef,
  onFileSelect,
  dragging,
  onBrowse,
  sourceFiles,
  uploadingFiles,
  fileDuplicates,
  onRemoveFile,
  localInstructions,
  onInstructionsChange,
  onInstructionsBlur,
  accounts,
  selectedAccountId,
  onAccountChange,
  onStart,
}: ImportDropZoneProps) {
  return (
    <>
      {!importSupported && (
        <ProviderUnsupportedBanner onOpenSettings={onOpenSettings} />
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileSelect}
      />
      <div
        onClick={onBrowse}
        className={`group relative cursor-pointer rounded-2xl border-2 border-dashed border-border bg-muted/30 transition duration-200 hover:border-brand/40 hover:bg-brand/5 ${
          dragging ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground transition-colors group-hover:bg-brand/10 group-hover:text-brand">
            <FileUp className="h-7 w-7" />
          </div>
          <p className="text-base font-medium text-foreground/80">
            Drop files or click to browse
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground/60">
            CSV and images of bank statements
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
                className="flex items-center gap-3 rounded-xl px-4 py-3 border bg-muted/50 border-border opacity-75"
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
                      ? "bg-amber-500/10 border-amber-500/30"
                      : "bg-muted/50 border-border"
                  }`}
                >
                  {isImageFilename(file.name) ? (
                    <Image className="h-4 w-4 text-muted-foreground/80 shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-muted-foreground/80 shrink-0" />
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
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveFile(file.name); }}
                    className="rounded-lg p-1 text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
              Instructions (optional)
            </div>
            <textarea
              value={localInstructions ?? ""}
              onChange={(e) => onInstructionsChange(e.target.value)}
              onBlur={onInstructionsBlur}
              placeholder="e.g. &quot;This is my Excel budget export, amounts are in the Debit/Credit columns&quot;"
              rows={2}
              className="w-full resize-none rounded-xl border border-input bg-muted/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/20 dark:bg-input/30"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <AccountSelector
              accounts={accounts}
              value={selectedAccountId}
              onChange={onAccountChange}
              placeholder="Any account"
              clearable
            />
            <Button
              onClick={onStart}
              disabled={uploadingFiles.size > 0 || !importSupported}
              className="gap-2 rounded-xl px-6 py-5 text-base font-semibold shadow-lg shadow-brand/20"
            >
              <Sparkles className="h-4.5 w-4.5" />
              Start Import
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Shown when no AI provider is configured — same nudge the empty Capy
 * overlay surfaces. Import needs intelligence; this is the single
 * provider-agnostic gate.
 */
function ProviderUnsupportedBanner({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-brand/20 bg-brand/5 px-6 py-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Sparkles className="h-7 w-7" />
      </div>
      <p className="text-lg font-medium text-foreground/80">Set up your AI assistant</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground/70">
        Pick an AI provider in settings before importing transactions.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-brand/90 transition-colors"
      >
        Open settings
      </button>
    </div>
  );
}
