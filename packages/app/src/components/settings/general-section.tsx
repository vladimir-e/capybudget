import { useTranslation } from "@capybudget/i18n"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useBudgetMeta } from "@/hooks/use-budget-meta"
import { useAppStore } from "@/stores/app-store"

declare const __IS_DEMO__: boolean

export function GeneralSection({ budgetPath }: { budgetPath: string }) {
  const { t } = useTranslation("settings")
  const { data, setName } = useBudgetMeta(budgetPath)
  const renameRecentBudget = useAppStore((s) => s.renameRecentBudget)
  const launchBudgetPath = useAppStore((s) => s.launchBudgetPath)
  const setLaunchBudgetPath = useAppStore((s) => s.setLaunchBudgetPath)

  // Uncontrolled, keyed on the stored name so an external change reseeds the
  // field. Committed on blur / Enter, so a rename is one file write, not one per keystroke.
  const commitName = (value: string) => {
    const next = value.trim()
    if (next && next !== data.name) {
      void setName(next)
      // Keep the home-screen recents tile in sync; otherwise it shows the name
      // captured when the budget was last opened until the next reopen.
      renameRecentBudget(budgetPath, next)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("general.title")}</CardTitle>
        <CardDescription>{t("general.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="budget-name">{t("general.budgetName")}</Label>
          <Input
            id="budget-name"
            key={data.name}
            defaultValue={data.name}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
          />
        </div>

        {!__IS_DEMO__ && (
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="open-on-launch">{t("general.openOnLaunch.label")}</Label>
              <p className="text-sm text-muted-foreground">
                {t("general.openOnLaunch.description")}
              </p>
            </div>
            <Switch
              id="open-on-launch"
              checked={launchBudgetPath === budgetPath}
              onCheckedChange={(checked) =>
                setLaunchBudgetPath(checked ? budgetPath : null)
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
