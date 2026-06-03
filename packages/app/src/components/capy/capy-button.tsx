import { Sparkles } from "lucide-react"

interface CapyButtonProps {
  active: boolean
  onClick: () => void
}

export function CapyButton({ active, onClick }: CapyButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? "Close Capy assistant" : "Open Capy assistant"}
      className={`
        relative flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium
        bg-brand text-primary-foreground transition-all duration-300 hover:brightness-110
        ${active ? "shadow-inner" : "shadow-sm"}
      `}
    >
      {/* Breathing halo — extends past the solid pill so the brand glow reads
          as an aura (inset-0 would be brand-on-brand and invisible). */}
      {!active && <div className="capy-glow absolute -inset-1 rounded-full" />}
      <Sparkles className="relative h-4 w-4" />
      <span className="relative hidden sm:inline">Ask Capy</span>
    </button>
  )
}
