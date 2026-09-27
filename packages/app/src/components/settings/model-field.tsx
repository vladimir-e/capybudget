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
import type { ModelOption } from "@/lib/model-option"

interface ModelFieldProps {
  id: string
  model: string
  onSaveModel: (m: string) => void
  models: ModelOption[]
  freeText?: boolean
}

export function ModelField({ id, model, onSaveModel, models, freeText = false }: ModelFieldProps) {
  const { t } = useTranslation("settings")
  const [customMode, setCustomMode] = useState(false)
  const options = withSavedModel(models, model)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{t("provider.model.label")}</Label>
        {!freeText && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox"
              className="h-3 w-3 cursor-pointer accent-brand"
              checked={customMode}
              onChange={(e) => setCustomMode(e.target.checked)}
            />
            {t("provider.model.useCustom")}
          </label>
        )}
      </div>
      {freeText || customMode ? (
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
          items={options}
          value={model}
          onValueChange={(v) => {
            if (typeof v === "string") onSaveModel(v)
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t("provider.model.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((m) => (
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

function withSavedModel(options: ModelOption[], model: string): ModelOption[] {
  if (!model || options.some((o) => o.value === model)) return options
  return [...options, { value: model, label: model }]
}
