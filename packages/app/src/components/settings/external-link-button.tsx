import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "lucide-react"

export function ExternalLinkButton({ label, href }: { label: string; href: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void openUrl(href)
      }}
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}
