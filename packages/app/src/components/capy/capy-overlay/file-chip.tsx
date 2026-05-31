import { File as FileIcon, Image, X } from "lucide-react"
import { formatFileSize } from "@capybudget/intelligence"

export function FileChip({
  name,
  size,
  mediaType,
  onRemove,
}: {
  name: string
  size: number
  mediaType: string
  onRemove?: () => void
}) {
  const Icon = mediaType.startsWith("image/") ? Image : FileIcon
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/8 px-2.5 py-1 text-xs text-foreground/70">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {name}
      <span className="text-muted-foreground/50">
        {formatFileSize(size)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          aria-label={`Remove ${name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
