import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { CurrencyCombobox } from "@/components/budget/currency-combobox"
import { useBudgetMeta } from "@/hooks/use-budget-meta"

export function GeneralSection({ budgetPath }: { budgetPath: string }) {
  const { data, setCurrency } = useBudgetMeta(budgetPath)

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Budget-wide basics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Label htmlFor="currency">Currency</Label>
        <CurrencyCombobox
          id="currency"
          value={data.currency}
          onChange={(code) => void setCurrency(code)}
        />
        <p className="text-xs text-muted-foreground">
          Changes display only — your balances aren’t converted.
        </p>
      </CardContent>
    </Card>
  )
}
