import { useState } from "react"
import { useSearch } from "@tanstack/react-router"
import { toast } from "sonner"
import { useTranslation } from "@capybudget/i18n"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCustomInstructions } from "@/hooks/use-custom-instructions"

/**
 * Editor for `capy-instructions.md` — the same chat-tuning file the Capy
 * overlay's instructions dialog edits. Changes take effect on the next
 * conversation (the system prompt is baked at session creation), so this
 * is intentionally not part of the session signature.
 */
export function ChatInstructionsSection() {
  const { t } = useTranslation(["settings", "common"])
  const { path } = useSearch({ from: "/budget" })
  const { instructions, isLoading, save } = useCustomInstructions(path)

  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const value = draft ?? instructions
  const hasChanges = draft !== null && draft !== instructions

  async function handleSave() {
    if (draft === null) return
    setSaving(true)
    try {
      await save(draft)
      setDraft(null)
      toast.success(t("chatInstructions.saved"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("chatInstructions.title")}</CardTitle>
        <CardDescription>{t("chatInstructions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isLoading}
          placeholder={t("chatInstructions.placeholder")}
          rows={8}
          className="w-full resize-none rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-brand/50 disabled:opacity-50"
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!hasChanges || saving} size="sm">
            {saving ? t("common:actions.saving") : t("common:actions.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
