import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeft, Coins, RefreshCw, Shapes, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GeneralSection } from "./general-section"
import { CurrencySection } from "./currency-section"
import { ProviderSection } from "./provider-section"
import { ChatInstructionsSection } from "./chat-instructions-section"
import { CategoriesSection } from "./categories-section"
import { UpdatesSection } from "./updates-section"

declare const __IS_DEMO__: boolean

type SettingsSection = "general" | "intelligence" | "categories" | "updates"

const SECTIONS: {
  id: SettingsSection
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  {
    id: "general",
    label: "General",
    description: "Currency & basics",
    icon: Coins,
  },
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
  {
    id: "updates",
    label: "Updates",
    description: "App version",
    icon: RefreshCw,
  },
]

const SECTION_IDS = new Set(SECTIONS.map((s) => s.id))

function resolveSection(section: string | undefined): SettingsSection {
  if (section && SECTION_IDS.has(section as SettingsSection)) {
    if (section === "updates" && __IS_DEMO__) return "general"
    return section as SettingsSection
  }
  return "general"
}

export function SettingsScreen() {
  const navigate = useNavigate()
  const { path, name, section } = useSearch({ from: "/budget" })
  const [active, setActive] = useState<SettingsSection>(() => resolveSection(section))

  // Re-sync when a deep-link changes the param on an already-mounted screen
  // (e.g. the boot update toast navigating to ?section=updates). Sidebar
  // clicks call setActive without touching the URL, so they don't trip this.
  useEffect(() => {
    setActive(resolveSection(section))
  }, [section])

  const visibleSections = SECTIONS.filter((s) => s.id !== "updates" || !__IS_DEMO__)

  const handleBack = useCallback(() => {
    navigate({ to: "/budget", search: { path, name } })
  }, [navigate, path, name])

  // Esc returns to the budget — like the Help screen — but not while a field is
  // focused, so inputs keep their own Esc (e.g. cancelling a category rename).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      const t = e.target as HTMLElement
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return
      e.preventDefault()
      handleBack()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [handleBack])

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
          {visibleSections.map((s) => (
            <SectionItem
              key={s.id}
              {...s}
              active={active === s.id}
              onSelect={() => setActive(s.id)}
            />
          ))}
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
          {active === "general" && (
            <>
              <GeneralSection budgetPath={path} />
              <CurrencySection budgetPath={path} />
            </>
          )}
          {active === "intelligence" && (
            <>
              <ProviderSection />
              {/* AI is desktop-only; the demo has no instructions file to edit. */}
              {!__IS_DEMO__ && <ChatInstructionsSection />}
            </>
          )}
          {active === "categories" && <CategoriesSection />}
          {!__IS_DEMO__ && active === "updates" && <UpdatesSection />}
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
