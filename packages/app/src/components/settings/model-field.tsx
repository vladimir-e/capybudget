import { useState } from "react"
import { useTranslation } from "@capybudget/i18n"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface ModelOption {
  value: string
  label: string
}

interface ModelFieldProps {
  /** Unique id linking the label to the control. */
  id: string
  model: string
  onSaveModel: (m: string) => void
  models: ModelOption[]
}

/**
 * Model picker shared by every provider config: a curated dropdown plus a
 * "Use a custom model" toggle that swaps in a free-text field for any model
 * ID outside the list. A saved value not in the list opens in custom mode so
 * the user's choice survives a refreshed list.
 */
export function ModelField({ id, model, onSaveModel, models }: ModelFieldProps) {
  const { t } = useTranslation("settings")
  const isModelInList = models.some((m) => m.value === model)
  const [customMode, setCustomMode] = useState(!isModelInList && model !== "")

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{t("provider.model.label")}</Label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <input
            type="checkbox"
            className="h-3 w-3 cursor-pointer accent-brand"
            checked={customMode}
            onChange={(e) => setCustomMode(e.target.checked)}
          />
          {t("provider.model.useCustom")}
        </label>
      </div>
      {customMode ? (
        <Input
          id={id}
          placeholder={t("provider.model.customPlaceholder")}
          value={model}
          onChange={(e) => onSaveModel(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      ) : (
        <Select
          value={model}
          onValueChange={(v) => {
            if (typeof v === "string") onSaveModel(v)
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t("provider.model.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
