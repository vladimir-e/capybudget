import { File as FileIcon, Loader2, Wrench } from "lucide-react";
import { getToolLabel } from "@/lib/tool-labels";
import {
  formatFileSize,
  type ChatMessage,
  type ContentBlock,
} from "@capybudget/intelligence";

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

export function ProcessingStatus({ messages }: { messages: ChatMessage[] }) {
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
