import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useBudgetMeta } from "@/hooks/use-budget-meta"

export function GeneralSection({ budgetPath }: { budgetPath: string }) {
  const { data, setName } = useBudgetMeta(budgetPath)

  // Uncontrolled, keyed on the stored name so an external change (or a reverted
  // commit) reseeds the field. Committed on blur / Enter, so a rename is one
  // file write rather than one per keystroke.
  const commitName = (value: string) => {
    const next = value.trim()
    if (next && next !== data.name) void setName(next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Budget-wide basics.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="budget-name">Budget name</Label>
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
      </CardContent>
    </Card>
  )
}
