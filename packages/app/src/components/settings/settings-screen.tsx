import { useState } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeft, Shapes, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderSection } from "./provider-section"
import { ChatInstructionsSection } from "./chat-instructions-section"
import { CategoriesSection } from "./categories-section"

declare const __IS_DEMO__: boolean

type SettingsSection = "intelligence" | "categories"

const SECTIONS: {
  id: SettingsSection
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  {
    id: "intelligence",
    label: "Intelligence",
    description: "AI provider",
    icon: Sparkles,
  },
  {
    id: "categories",
    label: "Categories",
    description: "Organize spending",
    icon: Shapes,
  },
]

export function SettingsScreen() {
  const navigate = useNavigate()
  const { path, name } = useSearch({ from: "/budget" })
  const [active, setActive] = useState<SettingsSection>("intelligence")

  function handleBack() {
    navigate({ to: "/budget", search: { path, name } })
  }

  return (
    // Pin to the viewport (like BudgetShell) so the content pane scrolls, not
    // the page — otherwise the sidebar (and its back button) scroll away. The
    // min width + horizontal scroll keeps the demo usable if opened on a phone.
    <div className="h-screen overflow-x-auto overflow-y-hidden">
    <div className="flex h-full min-w-[48rem]">
      <nav
        aria-label="Settings sections"
        className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Back to budget"
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-base font-bold tracking-tight">Settings</h2>
        </div>
        <div className="flex flex-col gap-0.5 px-2">
          {SECTIONS.map((section) => (
            <SectionItem
              key={section.id}
              {...section}
              active={active === section.id}
              onSelect={() => setActive(section.id)}
            />
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
          {active === "intelligence" && (
            <>
              <ProviderSection />
              {/* AI is desktop-only; the demo has no instructions file to edit. */}
              {!__IS_DEMO__ && <ChatInstructionsSection />}
            </>
          )}
          {active === "categories" && <CategoriesSection />}
        </div>
      </main>
    </div>
    </div>
  )
}

function SectionItem({
  label,
  description,
  icon: Icon,
  active,
  onSelect,
}: {
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-brand/15 text-brand" : "bg-sidebar-accent/40 text-sidebar-foreground/60"
        }`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}
