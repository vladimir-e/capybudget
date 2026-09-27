import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "lucide-react"

export function ExternalLinkButton({ label, href }: { label: string; href: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        void openUrl(href)
      }}
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}
