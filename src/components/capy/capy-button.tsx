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
        relative flex h-10 w-10 items-center justify-center rounded-xl
        transition-all duration-300
        ${
          active
            ? "bg-brand text-primary-foreground shadow-lg"
            : "text-brand hover:bg-brand/10"
        }
      `}
    >
      {!active && <div className="capy-glow absolute inset-0 rounded-xl" />}
      <Sparkles className="relative h-5 w-5" />
    </button>
  )
}
