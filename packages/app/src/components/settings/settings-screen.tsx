import { useRouter } from "@tanstack/react-router"
import { ArrowLeft, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderSection } from "./provider-section"

export function SettingsScreen() {
  const router = useRouter()

  function handleBack() {
    if (router.history.length > 1) {
      router.history.back()
    } else {
      router.navigate({ to: "/" })
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-gradient-to-b from-brand-subtle/40 to-transparent px-6 py-5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label="Back"
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15 text-brand">
            <Settings className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
            <p className="text-sm text-muted-foreground">
              Configure your AI provider and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <ProviderSection />
        </div>
      </div>
    </div>
  )
}
